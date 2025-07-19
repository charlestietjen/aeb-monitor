// Canadian Tire Stock Checker
// Uses stocktrack.ca to check stock availability at specified Canadian Tire stores

// No external imports needed - we'll use the built-in Deno.connect for SMTP

// Define types for our configuration
interface StoreStock {
  store: string;
  quantity: number;
  name?: string;
  location?: string;
  price?: number;
}

interface StockResponse {
  stores: StoreStock[];
  sku: string;
  name?: string;
}

// Define types for the stocktrack.ca API response
interface StockTrackItem {
  min_ago: number;
  Store: string;
  SKU: string;
  CheckDigit: string;
  Product: string;
  Price: number;
  Quantity: number;
  Description: string;
  PartNumber: string;
  Promo?: {
    PriorPrice: number[];
    Origin: string;
    EndDate: string;
  };
  Location?: {
    Aisle: string;
  };
  SaveStory?: string;
  Corporate?: {
    Quantity: number;
  };
  isOnline?: {
    Orderable: string;
  };
}

interface EmailConfig {
  provider: string; // "smtp" or "console"
  host: string;     // SMTP server hostname
  port: number;     // SMTP server port
  secure: boolean;  // Use TLS
  username?: string; // SMTP username (if authentication is required)
  password?: string; // SMTP password (if authentication is required)
  fromEmail: string; // Sender email address
  fromName?: string; // Sender name (optional)
}

interface Config {
  email: string;
  checkIntervalMinutes: number;
  stores: string[];
  sku: string;
  emailConfig: EmailConfig;
}

// Load configuration from config.json
async function loadConfig(): Promise<Config> {
  try {
    const configText = await Deno.readTextFile("./config.json");
    const config = JSON.parse(configText) as Config;
    return config;
  } catch (error) {
    console.error("Error loading config.json:", error);
    throw new Error("Failed to load configuration");
  }
}

// Check stock availability at specified stores
async function checkStock(config: Config): Promise<StockResponse> {
  const { stores, sku } = config;
  const storeParam = stores.join(",");
  const url = `https://stocktrack.ca/ct/availability.php?store=${storeParam}&sku=${sku}&src=upc`;
  
  try {
    // Add browser-like headers to avoid 403 Forbidden error
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      "Referer": "https://stocktrack.ca/"
    };
    
    console.log(`Fetching data from: ${url}`);
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const jsonData = await response.json() as StockTrackItem[];
    
    // Parse the JSON response to extract stock information
    const storeStocks: StoreStock[] = [];
    let productName = "";
    
    // Process each item in the JSON response
    if (jsonData && jsonData.length > 0) {
      // Get the product name from the first item
      productName = jsonData[0].Description || "";
      
      // Process each store's data
      for (const item of jsonData) {
        storeStocks.push({
          store: item.Store,
          quantity: item.Quantity,
          name: `Canadian Tire ${item.Store}`,
          location: item.Location?.Aisle,
          price: item.Price
        });
      }
    } else {
      // If no data is returned, assume all stores are out of stock
      for (const store of stores) {
        storeStocks.push({
          store,
          quantity: 0
        });
      }
    }
    
    return {
      stores: storeStocks,
      sku,
      name: productName
    };
  } catch (error) {
    console.error("Error checking stock:", error);
    throw new Error("Failed to check stock availability");
  }
}

// Send notification when stock is available
async function sendNotification(config: Config, stockInfo: StockResponse): Promise<void> {
  const { email, emailConfig } = config;
  const { stores, sku, name } = stockInfo;
  
  // Filter stores with stock
  const storesWithStock = stores.filter(store => store.quantity > 0);
  
  if (storesWithStock.length === 0) {
    console.log("No stock available, skipping notification");
    return;
  }
  
  try {
    const storeList = storesWithStock
      .map(store => {
        let info = `${store.name || store.store}: ${store.quantity} in stock`;
        if (store.price) {
          info += ` at $${store.price.toFixed(2)}`;
        }
        if (store.location) {
          info += ` (${store.location})`;
        }
        return info;
      })
      .join("\n");
    
    const subject = `Stock Alert: ${name || sku} Available at Canadian Tire`;
    const plainTextContent = `
      Stock Alert!
      
      The item you're tracking (${name || sku}) is now in stock at the following Canadian Tire locations:
      
      ${storeList}
      
      Check it out at: https://stocktrack.ca/ct/availability.php?store=${config.stores.join(",")}&sku=${sku}&src=upc
    `;
    
    const htmlContent = `
      <h1>Stock Alert!</h1>
      <p>The item you're tracking <strong>${name || sku}</strong> is now in stock at the following Canadian Tire locations:</p>
      <pre>${storeList}</pre>
      <p>Check it out at: <a href="https://stocktrack.ca/ct/availability.php?store=${config.stores.join(",")}&sku=${sku}&src=upc">StockTrack</a></p>
    `;
    
    if (emailConfig.provider === "smtp") {
      // Send email using direct SMTP
      // We're using the system mail command, so we don't need SMTP credentials
      const { host, port, fromEmail } = emailConfig;
      const fromName = emailConfig.fromName || "Canadian Tire Stock Checker";
      
      // Basic validation
      if (!host || !port) {
        throw new Error("SMTP host and port are required");
      }
      
      console.log(`Sending email notification to ${email} via SMTP...`);
      
      try {
        // Use the system mail command on the DigitalOcean droplet
        // This is a simple approach that relies on the server's mail configuration
        // The mail command should be available on most Linux systems
        
        // Create a temporary file for the email content
        const tempFileName = `/tmp/stock_alert_${Date.now()}.txt`;
        const emailContent = `Subject: ${subject}\nFrom: ${fromName} <${fromEmail}>\nTo: ${email}\nContent-Type: text/html\n\n${htmlContent}`;
        
        await Deno.writeTextFile(tempFileName, emailContent);
        
        // Use the mail command to send the email
        const mailCommand = new Deno.Command("mail", {
          args: ["-t", "<", tempFileName],
          stdout: "piped",
          stderr: "piped",
        });
        
        const { code, stderr } = await mailCommand.output();
        
        // Clean up the temporary file
        await Deno.remove(tempFileName);
        
        if (code !== 0) {
          const errorOutput = new TextDecoder().decode(stderr);
          throw new Error(`Mail command failed: ${errorOutput}`);
        }
        
        console.log(`Email notification sent to ${email} successfully`);
      } catch (error) {
        console.error("Email error:", error);
        throw new Error(`Failed to send email: ${String(error)}`);
      }
    } else {
      // Default to console output
      console.log("\n=== STOCK NOTIFICATION ===\n");
      console.log(`To: ${email}`);
      console.log(`Subject: ${subject}`);
      console.log(plainTextContent);
      console.log("\n=========================\n");
      
      console.log(`Notification would be sent to ${email} in production`);
      console.log("Note: Email functionality is using console mode. Set provider to 'sendgrid' and add API key for real emails.");
    }
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

// Main function to run the stock checker
async function main() {
  try {
    console.log("Loading configuration...");
    const config = await loadConfig();
    
    console.log(`Starting stock checker for SKU ${config.sku}`);
    console.log(`Checking ${config.stores.length} stores every ${config.checkIntervalMinutes} minutes`);
    
    // Initial check
    await runCheck(config);
    
    // Set up periodic checks
    const intervalMs = config.checkIntervalMinutes * 60 * 1000;
    setInterval(() => runCheck(config), intervalMs);
  } catch (error) {
    console.error("Error in main function:", error);
    Deno.exit(1);
  }
}

// Run a single stock check
async function runCheck(config: Config) {
  try {
    console.log(`Checking stock at ${new Date().toLocaleString()}...`);
    const stockInfo = await checkStock(config);
    
    // Log stock information
    console.log(`Stock information for SKU ${stockInfo.sku} (${stockInfo.name || "Unknown"}):`);    
    for (const store of stockInfo.stores) {
      let storeInfo = `  ${store.name || store.store}: ${store.quantity} in stock`;
      
      if (store.quantity > 0) {
        if (store.price) {
          storeInfo += ` at $${store.price.toFixed(2)}`;
        }
        
        if (store.location) {
          storeInfo += ` (${store.location})`;
        }
      }
      
      console.log(storeInfo);
    }
    
    // Check if any store has stock
    const hasStock = stockInfo.stores.some(store => store.quantity > 0);
    
    if (hasStock) {
      console.log("Stock found! Sending notification...");
      await sendNotification(config, stockInfo);
    } else {
      console.log("No stock available at any store.");
    }
  } catch (error) {
    console.error("Error running stock check:", error);
  }
}

// Start the application
main();
