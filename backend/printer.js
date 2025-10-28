// printer.js - Simple and reliable thermal printing
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Print directly to thermal printer using file copy
 */
async function printDirectToThermal(receiptText, printerName = 'POSPrinter POS58') {
  return new Promise((resolve, reject) => {
    try {
      // Create ESC/POS formatted text for thermal printer
      const ESC = '\x1b';
      const thermalText = [
        ESC + '@',          // Initialize printer
        ESC + 'a' + '\x01', // Center alignment
        'CHURCH ACTIVITY\n',
        'PAYMENT RECEIPT\n',
        ESC + 'a' + '\x00', // Left alignment
        '================================\n',
        receiptText,
        '\n\n\n',          // Feed paper
        '\x1d\x56\x00'     // Cut paper
      ].join('');
      
      const tempFile = `thermal_${Date.now()}.prn`;
      const tempFilePath = path.join(process.cwd(), tempFile);
      
      // Write as binary to preserve ESC/POS commands
      fs.writeFileSync(tempFilePath, thermalText, { encoding: 'binary' });
      console.log(`Created thermal file: ${tempFilePath}`);
      
      // Method 1: Try direct copy to printer share
      exec(`copy /b "${tempFilePath}" "\\\\localhost\\${printerName}"`, (error1, stdout1, stderr1) => {
        if (!error1) {
          console.log(`Direct copy to \\\\localhost\\${printerName} succeeded`);
          try { fs.unlinkSync(tempFilePath); } catch (e) {}
          resolve();
          return;
        }
        
        console.log(`Direct copy failed: ${error1.message}, trying net use method`);
        
        // Method 2: Try net use then copy
        exec(`net use LPT1: "\\\\localhost\\${printerName}" /persistent:no && copy /b "${tempFilePath}" LPT1: && net use LPT1: /delete`, (error2, stdout2, stderr2) => {
          if (!error2) {
            console.log(`Net use method succeeded`);
            try { fs.unlinkSync(tempFilePath); } catch (e) {}
            resolve();
            return;
          }
          
          console.log(`Net use failed: ${error2.message}, trying simple copy to PRN`);
          
          // Method 3: Try copy to PRN (default printer)
          exec(`copy /b "${tempFilePath}" PRN`, (error3, stdout3, stderr3) => {
            try { fs.unlinkSync(tempFilePath); } catch (e) {}
            
            if (!error3) {
              console.log(`Copy to PRN succeeded`);
              resolve();
            } else {
              console.log(`All copy methods failed. Last error: ${error3.message}`);
              reject(new Error(`All direct printing methods failed: ${error3.message}`));
            }
          });
        });
      });
      
    } catch (error) {
      reject(new Error(`Direct print setup error: ${error.message}`));
    }
  });
}

/**
 * Try printing via Windows print spooler using type command
 */
async function printViaSpooler(receiptText, printerName) {
  return new Promise((resolve, reject) => {
    try {
      const tempFile = `spooler_${Date.now()}.txt`;
      const tempFilePath = path.join(process.cwd(), tempFile);
      
      // Format for thermal printer with proper spacing
      const thermalText = receiptText
        .replace(/\n/g, '\r\n')
        .replace(/={32,}/g, '================================');
      
      fs.writeFileSync(tempFilePath, thermalText + '\r\n\r\n\r\n\x0C', { encoding: 'utf8' });
      console.log(`Created spooler file: ${tempFilePath}`);
      
      // Try using type command to send to printer
      exec(`type "${tempFilePath}" > "\\\\localhost\\${printerName}"`, (error1, stdout1, stderr1) => {
        if (!error1) {
          console.log(`Type command to ${printerName} succeeded`);
          try { fs.unlinkSync(tempFilePath); } catch (e) {}
          resolve();
          return;
        }
        
        console.log(`Type to printer failed: ${error1.message}, trying echo method`);
        
        // Alternative: Use echo with redirection
        exec(`echo. > "\\\\localhost\\${printerName}" && type "${tempFilePath}" >> "\\\\localhost\\${printerName}"`, (error2, stdout2, stderr2) => {
          try { fs.unlinkSync(tempFilePath); } catch (e) {}
          
          if (!error2) {
            console.log(`Echo method succeeded`);
            resolve();
          } else {
            console.log(`Echo method failed: ${error2.message}`);
            reject(new Error(`Spooler printing failed: ${error2.message}`));
          }
        });
      });
      
    } catch (error) {
      reject(new Error(`Spooler setup error: ${error.message}`));
    }
  });
}

/**
 * Create compact receipt text
 */
function createCompactReceipt({ title, subtitle, header, lines, footer }) {
  const receiptLines = [];
  
  if (title) receiptLines.push(title);
  if (subtitle) receiptLines.push(subtitle);
  
  if (header && header.length > 0) {
    receiptLines.push('================================');
    header.forEach(line => {
      if (!line.includes('====')) {
        receiptLines.push(line);
      }
    });
  }
  
  if (lines && lines.length > 0) {
    lines.forEach(line => {
      if (line.trim() !== '') {
        receiptLines.push(line);
      }
    });
  }
  
  if (footer && footer.length > 0) {
    receiptLines.push('================================');
    footer.forEach(line => receiptLines.push(line));
  }
  
  receiptLines.push('================================');
  return receiptLines.join('\n');
}

/**
 * Main print function with multiple fallbacks
 */
export async function printReceipt({ title, subtitle, header, lines, footer, printerShareName }) {
  try {
    console.log('Starting receipt print process...');
    
    const compactReceiptText = createCompactReceipt({ title, subtitle, header, lines, footer });
    const printerName = printerShareName || process.env.THERMAL_PRINTER_NAME || 'POSPrinter POS58';
    // const printerName = printerShareName || process.env.THERMAL_PRINTER_NAME || 'Receipt-Printer';
    
    console.log(`Trying to print to: ${printerName}`);
    
    // Method 1: Try direct thermal printing
    try {
      await printDirectToThermal(compactReceiptText, printerName);
      console.log('Method 1 (Direct thermal) succeeded');
      return;
    } catch (method1Error) {
      console.log('Method 1 failed:', method1Error.message);
    }
    
    // Method 2: Try alternative thermal printer
    if (printerName !== 'Receipt-Printer') {
      try {
        await printDirectToThermal(compactReceiptText, 'Receipt-Printer');
        console.log('Method 2 (Alternative thermal) succeeded');
        return;
      } catch (method2Error) {
        console.log('Method 2 failed:', method2Error.message);
      }
    }
    
    // Method 3: Try Windows spooler printing
    try {
      await printViaSpooler(compactReceiptText, printerName);
      console.log('Method 3 (Windows spooler) succeeded');
      return;
    } catch (method3Error) {
      console.log('Method 3 failed:', method3Error.message);
    }
    
    // All methods failed
    console.log('All printing methods failed, logging receipt:');
    console.log(compactReceiptText);
    console.log('--- End of Receipt ---');
    
    throw new Error('All printing methods failed');
    
  } catch (error) {
    console.error('Receipt printing error:', error.message);
    throw error;
  }
}