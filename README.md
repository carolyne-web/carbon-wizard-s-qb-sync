# Shopify to QuickBooks Online Sync

This application automatically syncs Shopify B2B orders (tagged with `b2b-request`) to QuickBooks Online, creating Sales Receipts for paid orders and Invoices for unpaid orders.

## Features

- ✅ Shopify webhook verification
- ✅ Duplicate order prevention
- ✅ Maps customers, products, taxes, shipping, and discounts
- ✅ Creates Sales Receipts (paid orders) or Invoices (unpaid orders)
- ✅ Error handling with retry mechanism
- ✅ SQLite database for sync tracking
- ✅ Health check and status endpoints

## Prerequisites

1. Shopify Admin API access with:
   - `read_orders` permission
   - `write_orders` permission (for webhooks)
   - Private app or custom app credentials

2. QuickBooks Online API access:
   - Developer account
   - OAuth 2.0 Bearer token
   - Company ID

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Configure the following variables:

#### Shopify Settings:
- `SHOPIFY_STORE_NAME`: Your store name (without .myshopify.com)
- `SHOPIFY_ACCESS_TOKEN`: Your private app access token
- `SHOPIFY_WEBHOOK_SECRET`: Secret key for webhook verification

#### QuickBooks Settings:
- `QUICKBOOKS_ACCESS_TOKEN`: OAuth 2.0 Bearer token
- `QUICKBOOKS_COMPANY_ID`: Your QuickBooks company ID
- `QUICKBOOKS_SANDBOX`: Set to 'true' for sandbox, 'false' for production

#### QuickBooks Item Configuration:
Configure these based on your QuickBooks setup:
- `QUICKBOOKS_DEFAULT_ITEM_ID`: Default service/product item ID
- `QUICKBOOKS_SHIPPING_ITEM_ID`: Shipping item ID
- `QUICKBOOKS_TAX_ITEM_ID`: Tax item ID
- `QUICKBOOKS_DISCOUNT_ITEM_ID`: Discount item ID
- `QUICKBOOKS_DEFAULT_CUSTOMER_ID`: Default customer for guest orders
- `QUICKBOOKS_DEPOSIT_ACCOUNT_ID`: Bank account for deposits (default: Undeposited Funds)

### 3. Local Development

```bash
npm run dev
```

The server will start on `http://localhost:3000`

### 4. Register Webhooks

After deploying your app, register the Shopify webhook:

```bash
# List existing webhooks
node registerWebhook.js list

# Register the orders/create webhook
node registerWebhook.js register

# Delete a webhook (if needed)
node registerWebhook.js delete <webhook_id>
```

## Deployment on Render

### 1. Create New Web Service

1. Go to [Render Dashboard](https://render.com/dashboard)
2. Click "New" → "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `shopify-quickbooks-sync`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### 2. Environment Variables

In Render dashboard, go to Environment and add all variables from your `.env` file:

```
SHOPIFY_STORE_NAME=your-store-name
SHOPIFY_ACCESS_TOKEN=shpat_your_access_token
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret
QUICKBOOKS_CONSUMER_KEY=your_consumer_key
QUICKBOOKS_CONSUMER_SECRET=your_consumer_secret
QUICKBOOKS_ACCESS_TOKEN=your_access_token
QUICKBOOKS_ACCESS_TOKEN_SECRET=your_access_token_secret
QUICKBOOKS_REFRESH_TOKEN=your_refresh_token
QUICKBOOKS_COMPANY_ID=your_company_id
QUICKBOOKS_DEFAULT_ITEM_ID=1
QUICKBOOKS_SHIPPING_ITEM_ID=2
QUICKBOOKS_TAX_ITEM_ID=3
QUICKBOOKS_DISCOUNT_ITEM_ID=4
QUICKBOOKS_DEFAULT_CUSTOMER_ID=1
QUICKBOOKS_DEPOSIT_ACCOUNT_ID=35
WEBHOOK_URL=https://your-app-name.onrender.com
```

### 3. Deploy

1. Click "Create Web Service"
2. Wait for deployment to complete
3. Note your app URL: `https://your-app-name.onrender.com`
4. Update `WEBHOOK_URL` environment variable with your actual URL
5. Register webhooks using the script

## API Endpoints

- `POST /webhook/orders/create` - Shopify webhook endpoint
- `GET /health` - Health check
- `GET /sync-status/:orderId` - Check sync status for a specific order

## How It Works

1. **Webhook Reception**: Shopify sends order data to `/webhook/orders/create`
2. **Verification**: HMAC signature verification ensures request authenticity
3. **Tag Check**: Only processes orders with `b2b-request` tag
4. **Duplicate Check**: Prevents re-processing already synced orders
5. **Customer Mapping**: Finds existing QB customer or creates new one
6. **Transaction Creation**: Creates Sales Receipt (paid) or Invoice (unpaid)
7. **Record Keeping**: Stores sync record in SQLite database

## Data Mapping

### Shopify → QuickBooks
- **Customer**: Email-based lookup, creates if not found
- **Line Items**: Maps to QB items (uses default item ID)
- **Shipping**: Added as separate line item
- **Taxes**: Added as separate line items
- **Discounts**: Added as negative line items
- **Payment Status**: Determines Sales Receipt vs Invoice

## Error Handling

- **Retry Mechanism**: Failed operations retry up to 3 times with exponential backoff
- **Webhook Failures**: Returns 500 status, Shopify will retry
- **Database Logging**: All sync attempts logged with status
- **Graceful Degradation**: Continues processing even if non-critical operations fail

## Monitoring

Check sync status:
```bash
curl https://your-app.onrender.com/health
curl https://your-app.onrender.com/sync-status/SHOPIFY_ORDER_ID
```

## Security Considerations

- Webhook HMAC verification prevents unauthorized requests
- Environment variables secure API credentials
- Database stores only necessary sync metadata
- No sensitive data logged

## Troubleshooting

### Common Issues:

1. **Webhook Verification Failed**
   - Check `SHOPIFY_WEBHOOK_SECRET` matches Shopify settings
   
2. **QuickBooks API Errors**
   - Verify OAuth tokens are valid
   - Check company ID is correct
   - Ensure required QB items exist

3. **Customer Creation Failed**
   - Verify customer data format
   - Check QB permissions

4. **Item Mapping Issues**
   - Ensure default item IDs exist in QuickBooks
   - Check item types are compatible

## Development

### Running Tests
```bash
npm test
```

### Database Schema
```sql
CREATE TABLE sync_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shopify_order_id TEXT UNIQUE,
    quickbooks_transaction_id TEXT,
    transaction_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending'
);
```

## License

MIT