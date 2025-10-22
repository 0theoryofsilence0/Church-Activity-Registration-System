# Quick Printer Test

## Changes Made

### 1. Updated Printer Name in `.env`
- **Old**: `THERMAL_PRINTER_NAME=POS-58`
- **New**: `THERMAL_PRINTER_NAME=POSPrinter POS58`

This matches your actual Windows printer name exactly.

### 2. Simplified Raw Printing Method
Replaced complex PowerShell script with simple CMD copy command:

```javascript
copy /b "tempfile.prn" "\\localhost\POSPrinter POS58"
```

This is the most reliable method for sending raw data to Windows printers.

### Why Your Printer Wasn't Printing Before:

The console showed "Successfully wrote to USB001" but nothing printed because:

❌ **Writing to USB001 directly** doesn't trigger the Windows print spooler
✅ **Using `copy` command to printer name** goes through Windows spooler and actually prints

## Test Now

### Option 1: Test from Settings Page
1. Go to **Settings** in the app
2. Click **"Test Thermal Printer"**
3. **Receipt should print!**

### Option 2: Print Actual Receipt
1. Go to roster page
2. Click on any paid camper
3. Click **"Print"**
4. **Receipt should print!**

## What You Should See in Console

### Before (not printing):
```
Successfully wrote to USB001
Raw thermal printing succeeded
```

### Now (actually printing):
```
Attempting raw print to USB001
Created temp file: C:\Users\...\receipt_xxx.prn
Executing: copy /b "..." "\\localhost\POSPrinter POS58"
CMD output:         1 file(s) copied.
Successfully sent to printer: POSPrinter POS58
Raw thermal printing succeeded
Receipt printed via thermal printer
```

## Troubleshooting

### If it still doesn't print:

1. **Check printer status**:
   ```powershell
   Get-Printer "POSPrinter POS58"
   ```
   Should show `PrinterStatus: Normal`

2. **Test with simple text**:
   ```cmd
   echo Test > test.txt
   copy test.txt "\\localhost\POSPrinter POS58"
   ```
   If this prints, the app should work too.

3. **Check printer queue**:
   - Open Settings → Printers
   - Right-click "POSPrinter POS58" → "See what's printing"
   - Check if jobs are stuck

4. **Restart printer**:
   - Turn off printer
   - Wait 10 seconds
   - Turn on printer
   - Try again

## Expected Output Format

```
     CHURCH ACTIVITY
     PAYMENT RECEIPT

================================

Date: 10/23/2025, 15:30
Receipt: YC-20251011-001
Invoice: INV-20251011-00001

CUSTOMER INFO:
Janine Angela Hernandez
Cong: Mayumi

PAYMENT DETAILS:
--------------------------------
Reg Fee             PHP 600.00
--------------------------------
Total               PHP 600.00
Paid                PHP 600.00
Change              PHP   0.00
================================

       PAID IN FULL

Thank you for your payment!
   See you at the event!

   This serves as your
   official receipt and
   proof of payment.

   Keep this receipt
   for your records
```

## Server Status

✅ **Server running** at http://0.0.0.0:3001
✅ **Printer name updated** to "POSPrinter POS58"
✅ **Using reliable CMD copy method**

**Ready to test!** 🎉

Try printing a receipt now - it should actually print to your thermal printer!
