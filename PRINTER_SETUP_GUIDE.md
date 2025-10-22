# Thermal Printer Setup & Troubleshooting Guide

## Recent Changes

I've updated the printer functionality to be more robust:

### 1. **Enhanced Print Execution** (lines 658-687 in server.js)
   - Changed from "fire and forget" mode to actual confirmation
   - Added multiple printing methods as fallbacks
   - Now tries: node-thermal-printer → raw USB write → PowerShell printer spooler

### 2. **Improved Raw Printing** (lines 431-563 in server.js)
   - Added Windows printer spooler method using PowerShell
   - Automatically finds printer by name pattern
   - Falls back to direct USB port writing if spooler fails

## How It Works

When you click "Print" on a receipt:

1. **Primary Method**: Uses `node-thermal-printer` library with "Generic / Text Only" interface
2. **Fallback 1**: Writes raw ESC/POS commands directly to USB port
3. **Fallback 2**: Uses Windows PowerShell to send data through printer spooler
4. **Fallback 3**: Generates PDF and sends to default Windows printer

## Printer Setup Requirements

### Step 1: Install Printer in Windows

1. **Connect your POS-58 thermal printer** to your computer via USB
2. **Open Windows Settings** → Devices → Printers & Scanners
3. **Add the printer** with these settings:
   - Driver: **"Generic / Text Only"** (IMPORTANT!)
   - Port: **USB001** (or the USB port your printer is connected to)
   - Name: Can be "POS-58" or keep default name

### Step 2: Verify Printer Name and Port

1. Open **PowerShell** and run:
   ```powershell
   Get-Printer | Format-Table Name, PortName
   ```

2. Look for your printer in the list. Note the exact name and port.

3. Update your `.env` file in the `backend` folder:
   ```env
   THERMAL_PRINTER_ENABLED=true
   THERMAL_PRINTER_NAME=POS-58
   THERMAL_PRINTER_PORT=USB001
   ```
   Replace `POS-58` with your actual printer name and `USB001` with your actual port.

### Step 3: Test the Printer

1. Go to **Settings** page in the app
2. Click **"Test Thermal Printer"** button
3. Check if a test receipt prints

## Troubleshooting

### Issue: "Success" message but nothing prints

**Possible causes:**

1. **Printer is offline or not ready**
   - Check printer power and connection
   - Open Windows printer queue and check status
   - Try printing a Windows test page

2. **Wrong printer name in .env**
   - Run `Get-Printer` in PowerShell to see exact name
   - Update `THERMAL_PRINTER_NAME` in `.env` file
   - Restart backend server

3. **USB port mismatch**
   - Check actual USB port in Printer Properties
   - Update `THERMAL_PRINTER_PORT` in `.env`
   - Restart backend server

4. **Driver issues**
   - Ensure you're using "Generic / Text Only" driver
   - If using manufacturer driver, try switching to Generic
   - Some POS printers need ESC/POS compatible drivers

### Issue: Error messages in console

Check the backend terminal for specific error messages:

- **"Could not establish any printer interface"** - Printer not found or not accessible
- **"All raw printing methods failed"** - USB port or Windows printer access issue
- **"Thermal printing failed, falling back to PDF"** - Thermal printing disabled or all methods failed

### Manual Printing Test

If the app isn't working, test the printer manually:

1. Create a text file with some content
2. Open Command Prompt as Administrator
3. Run: `copy test.txt \\localhost\POS-58` (replace with your printer name)
4. Check if it prints

## Backend Configuration

Current settings in `.env`:

```env
THERMAL_PRINTER_ENABLED=true
THERMAL_PRINTER_NAME=POS-58
THERMAL_PRINTER_PORT=USB001
```

- Set `THERMAL_PRINTER_ENABLED=false` to disable thermal printing (will use PDF instead)
- Change `THERMAL_PRINTER_NAME` to match your Windows printer name exactly
- Change `THERMAL_PRINTER_PORT` to match your actual USB port

## Receipt Format

The receipt now prints in this format:

```
         CHURCH ACTIVITY
         PAYMENT RECEIPT

================================

Date/Time: 10/23/2025, 15:30:45
Receipt No: YC-20251011-001
Invoice No: INV-20251011-00001

CUSTOMER INFORMATION:
Name: John Doe
Congregation: Mayumi

PAYMENT DETAILS:
--------------------------------
Registration Fee     PHP 600.00
--------------------------------
Total Amount Due     PHP 600.00
Amount Paid          PHP 600.00
Change               PHP   0.00
================================

         PAID IN FULL

   Thank you for your payment!
      See you at the event!

   This serves as your official
   receipt and proof of payment.

Keep this receipt for your records
```

## Additional Notes

- The printer must support ESC/POS commands (most thermal receipt printers do)
- Print width is typically 48 characters for 58mm printers
- Paper cutting is automatic if your printer supports it
- The backend logs all printing attempts - check console for debugging

## Need More Help?

If printing still doesn't work:

1. Check backend terminal for error messages
2. Verify printer works with Windows test page
3. Try disabling thermal printing (set `THERMAL_PRINTER_ENABLED=false`)
4. PDF fallback will always work as last resort
