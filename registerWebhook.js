require('dotenv').config();
const axios = require('axios');

async function registerWebhook() {
  const shopifyStore = process.env.SHOPIFY_STORE_NAME;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const webhookUrl = process.env.WEBHOOK_URL; // Your deployed app URL
  
  if (!shopifyStore || !accessToken || !webhookUrl) {
    console.error('Missing required environment variables:');
    console.error('- SHOPIFY_STORE_NAME:', !!shopifyStore);
    console.error('- SHOPIFY_ACCESS_TOKEN:', !!accessToken);
    console.error('- WEBHOOK_URL:', !!webhookUrl);
    process.exit(1);
  }

  const webhookData = {
    webhook: {
      topic: 'orders/create',
      address: `${webhookUrl}/webhook/orders/create`,
      format: 'json'
    }
  };

  try {
    const response = await axios.post(
      `https://${shopifyStore}.myshopify.com/admin/api/2023-10/webhooks.json`,
      webhookData,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Webhook registered successfully!');
    console.log('Webhook ID:', response.data.webhook.id);
    console.log('Topic:', response.data.webhook.topic);
    console.log('Address:', response.data.webhook.address);
    console.log('Created at:', response.data.webhook.created_at);
    
  } catch (error) {
    console.error('Error registering webhook:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

async function listWebhooks() {
  const shopifyStore = process.env.SHOPIFY_STORE_NAME;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  
  try {
    const response = await axios.get(
      `https://${shopifyStore}.myshopify.com/admin/api/2023-10/webhooks.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      }
    );

    console.log('Existing webhooks:');
    response.data.webhooks.forEach(webhook => {
      console.log(`- ID: ${webhook.id}, Topic: ${webhook.topic}, Address: ${webhook.address}`);
    });
    
  } catch (error) {
    console.error('Error listing webhooks:', error.response?.data || error.message);
  }
}

async function deleteWebhook(webhookId) {
  const shopifyStore = process.env.SHOPIFY_STORE_NAME;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  
  if (!webhookId) {
    console.error('Please provide webhook ID as argument');
    process.exit(1);
  }
  
  try {
    await axios.delete(
      `https://${shopifyStore}.myshopify.com/admin/api/2023-10/webhooks/${webhookId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      }
    );

    console.log(`Webhook ${webhookId} deleted successfully!`);
    
  } catch (error) {
    console.error('Error deleting webhook:', error.response?.data || error.message);
  }
}

// Command line interface
const command = process.argv[2];
const argument = process.argv[3];

switch (command) {
  case 'register':
    registerWebhook();
    break;
  case 'list':
    listWebhooks();
    break;
  case 'delete':
    deleteWebhook(argument);
    break;
  default:
    console.log('Usage:');
    console.log('  node registerWebhook.js register     - Register orders/create webhook');
    console.log('  node registerWebhook.js list        - List existing webhooks');
    console.log('  node registerWebhook.js delete <id> - Delete webhook by ID');
    process.exit(1);
}