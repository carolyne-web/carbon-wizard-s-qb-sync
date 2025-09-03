require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database('./sync_records.db');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sync_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shopify_order_id TEXT UNIQUE,
    quickbooks_transaction_id TEXT,
    transaction_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending'
  )`);
});

// Middleware
app.use(express.raw({ type: 'application/json' }));

// Shopify webhook verification
function verifyShopifyWebhook(data, hmacHeader) {
  const calculatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(data)
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(calculatedHmac),
    Buffer.from(hmacHeader)
  );
}

// Check if order already synced
function checkIfSynced(shopifyOrderId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM sync_records WHERE shopify_order_id = ?',
      [shopifyOrderId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Save sync record
function saveSyncRecord(shopifyOrderId, quickbooksId, transactionType, status = 'completed') {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO sync_records (shopify_order_id, quickbooks_transaction_id, transaction_type, status) VALUES (?, ?, ?, ?)',
      [shopifyOrderId, quickbooksId, transactionType, status],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// QuickBooks API helper
function getQuickBooksHeaders() {
  return {
    'Authorization': `Bearer ${process.env.QUICKBOOKS_ACCESS_TOKEN}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
}

function getQuickBooksBaseURL() {
  const companyId = process.env.QUICKBOOKS_COMPANY_ID;
  const sandbox = process.env.QUICKBOOKS_SANDBOX === 'true' ? 'sandbox-' : '';
  return `https://${sandbox}quickbooks.api.intuit.com/v3/company/${companyId}`;
}

// Map Shopify customer to QuickBooks customer
async function findOrCreateCustomer(shopifyCustomer) {
  if (!shopifyCustomer) {
    // Use default customer for guest orders
    return { Id: process.env.QUICKBOOKS_DEFAULT_CUSTOMER_ID || '1' };
  }

  try {
    // Search for existing customer by email
    const searchUrl = `${getQuickBooksBaseURL()}/query?query=SELECT * FROM Customer WHERE PrimaryEmailAddr = '${shopifyCustomer.email}'`;
    const response = await axios.get(searchUrl, { headers: getQuickBooksHeaders() });
    
    if (response.data.QueryResponse && response.data.QueryResponse.Customer && response.data.QueryResponse.Customer.length > 0) {
      return response.data.QueryResponse.Customer[0];
    } else {
      // Create new customer
      const customerData = {
        Name: `${shopifyCustomer.first_name} ${shopifyCustomer.last_name}`.trim(),
        CompanyName: shopifyCustomer.default_address?.company || '',
        PrimaryEmailAddr: {
          Address: shopifyCustomer.email
        },
        PrimaryPhone: {
          FreeFormNumber: shopifyCustomer.phone || shopifyCustomer.default_address?.phone || ''
        },
        BillAddr: shopifyCustomer.default_address ? {
          Line1: shopifyCustomer.default_address.address1,
          Line2: shopifyCustomer.default_address.address2,
          City: shopifyCustomer.default_address.city,
          CountrySubDivisionCode: shopifyCustomer.default_address.province_code,
          PostalCode: shopifyCustomer.default_address.zip,
          Country: shopifyCustomer.default_address.country
        } : null
      };

      const createUrl = `${getQuickBooksBaseURL()}/customer`;
      const createResponse = await axios.post(createUrl, { Customer: customerData }, { headers: getQuickBooksHeaders() });
      return createResponse.data.QueryResponse.Customer[0];
    }
  } catch (error) {
    console.error('Error with customer operation:', error.response?.data || error.message);
    // Return default customer on error
    return { Id: process.env.QUICKBOOKS_DEFAULT_CUSTOMER_ID || '1' };
  }
}

// Map Shopify line items to QuickBooks line items
async function mapLineItems(lineItems) {
  const qbLineItems = [];
  
  for (const item of lineItems) {
    // For simplicity, we'll use a default item or create items as needed
    // In production, you'd want to maintain a product mapping
    const lineItem = {
      Amount: parseFloat(item.price) * item.quantity,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: {
          value: process.env.QUICKBOOKS_DEFAULT_ITEM_ID || '1', // Use default service item
          name: item.title
        },
        Qty: item.quantity,
        UnitPrice: parseFloat(item.price)
      }
    };
    qbLineItems.push(lineItem);
  }
  
  return qbLineItems;
}

// Create QuickBooks transaction
async function createQuickBooksTransaction(order) {
  const customer = await findOrCreateCustomer(order.customer);
  const lineItems = await mapLineItems(order.line_items);
  
  // Add shipping if present
  if (order.shipping_lines && order.shipping_lines.length > 0) {
    for (const shipping of order.shipping_lines) {
      lineItems.push({
        Amount: parseFloat(shipping.price),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: {
            value: process.env.QUICKBOOKS_SHIPPING_ITEM_ID || '1'
          },
          UnitPrice: parseFloat(shipping.price),
          Qty: 1
        }
      });
    }
  }
  
  // Add tax if present
  if (order.tax_lines && order.tax_lines.length > 0) {
    for (const tax of order.tax_lines) {
      lineItems.push({
        Amount: parseFloat(tax.price),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: {
            value: process.env.QUICKBOOKS_TAX_ITEM_ID || '1'
          },
          UnitPrice: parseFloat(tax.price),
          Qty: 1
        }
      });
    }
  }
  
  // Handle discounts
  if (order.discount_applications && order.discount_applications.length > 0) {
    for (const discount of order.discount_applications) {
      const discountAmount = parseFloat(discount.value) * -1; // Negative for discount
      lineItems.push({
        Amount: discountAmount,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: {
            value: process.env.QUICKBOOKS_DISCOUNT_ITEM_ID || '1'
          },
          UnitPrice: discountAmount,
          Qty: 1
        }
      });
    }
  }
  
  const transactionData = {
    Line: lineItems,
    CustomerRef: {
      value: customer.Id
    },
    TxnDate: order.created_at.split('T')[0] // Format: YYYY-MM-DD
  };
  
  // Determine if it's paid or unpaid
  const isPaid = order.financial_status === 'paid';
  
  try {
    if (isPaid) {
      // Create Sales Receipt for paid orders
      const salesReceiptData = {
        ...transactionData,
        PaymentRefNum: order.name, // Use Shopify order number as reference
        DepositToAccountRef: {
          value: process.env.QUICKBOOKS_DEPOSIT_ACCOUNT_ID || '35' // Default to Undeposited Funds
        }
      };
      
      const url = `${getQuickBooksBaseURL()}/salesreceipt`;
      const response = await axios.post(url, { SalesReceipt: salesReceiptData }, { headers: getQuickBooksHeaders() });
      return { transaction: response.data.QueryResponse.SalesReceipt[0], type: 'SalesReceipt' };
    } else {
      // Create Invoice for unpaid orders
      const url = `${getQuickBooksBaseURL()}/invoice`;
      const response = await axios.post(url, { Invoice: transactionData }, { headers: getQuickBooksHeaders() });
      return { transaction: response.data.QueryResponse.Invoice[0], type: 'Invoice' };
    }
  } catch (error) {
    console.error('QuickBooks API Error:', error.response?.data || error.message);
    throw error;
  }
}

// Retry mechanism for failed operations
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
}

// Main webhook handler
app.post('/webhook/orders/create', async (req, res) => {
  try {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body;
    
    // Verify webhook
    if (!verifyShopifyWebhook(body, hmac)) {
      console.error('Webhook verification failed');
      return res.status(401).send('Unauthorized');
    }
    
    const order = JSON.parse(body.toString());
    console.log('Received order:', order.name);
    
    // Check if order has b2b-request tag
    if (!order.tags || !order.tags.includes('b2b-request')) {
      console.log('Order does not have b2b-request tag, skipping');
      return res.status(200).send('Order skipped - no b2b-request tag');
    }
    
    // Check if already synced
    const existingRecord = await checkIfSynced(order.id.toString());
    if (existingRecord) {
      console.log('Order already synced:', existingRecord);
      return res.status(200).send('Order already synced');
    }
    
    // Create transaction in QuickBooks with retry
    const result = await retryOperation(async () => {
      return await createQuickBooksTransaction(order);
    });
    
    // Save sync record
    await saveSyncRecord(
      order.id.toString(),
      result.transaction.Id,
      result.type,
      'completed'
    );
    
    console.log(`Successfully synced order ${order.name} to QuickBooks ${result.type} ${result.transaction.Id}`);
    res.status(200).send('Order synced successfully');
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    
    // Save failed record if we have order info
    if (req.body) {
      try {
        const order = JSON.parse(req.body.toString());
        await saveSyncRecord(order.id.toString(), null, null, 'failed');
      } catch (parseError) {
        console.error('Could not parse order for failed record:', parseError);
      }
    }
    
    res.status(500).send('Internal server error');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Sync status endpoint
app.get('/sync-status/:orderId', async (req, res) => {
  try {
    const record = await checkIfSynced(req.params.orderId);
    if (record) {
      res.json(record);
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  } catch (error) {
    console.error('Error checking sync status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/orders/create`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});