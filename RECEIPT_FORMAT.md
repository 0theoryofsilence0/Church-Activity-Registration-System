# Thermal Receipt Format - Optimized for 58mm Paper

## Changes Made

The receipt format has been optimized for 58mm thermal printers (POS-58) with a **32-character width**.

### Issues Fixed:
1. ✅ Lines no longer wrap or break incorrectly
2. ✅ Proper alignment for amounts (right-aligned)
3. ✅ Text fits within 32 character width
4. ✅ Long names are split across multiple lines
5. ✅ Footer messages are broken into shorter lines

## New Receipt Format (32 chars wide)

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

## Technical Details

### Character Width
- **32 characters** per line (standard for 58mm paper)
- Lines longer than 32 chars are truncated or split

### Formatting Features
1. **Header**: Centered, bold text
2. **Date/Time**: Shortened to fit (MM/DD/YYYY, HH:MM)
3. **Labels**: Shortened (e.g., "CUSTOMER INFO:" instead of "CUSTOMER INFORMATION:")
4. **Amounts**: Right-aligned using calculated spacing
5. **Footer**: Split into multiple short lines for better readability

### Right-Aligned Amounts

The amounts are right-aligned using this formula:
```javascript
const fee = `PHP ${receiptData.amount}`;
const regLine = `Reg Fee${' '.repeat(32 - 7 - fee.length)}${fee}`;
```

This ensures the amounts always align to the right side of the receipt.

### Long Name Handling

If a customer name exceeds 32 characters, it's automatically split:
```javascript
if (name.length > 32) {
  printer.println(name.substring(0, 32));
  printer.println(name.substring(32));
}
```

## What Changed in Code

### File: `backend/server.js`

#### 1. Printer Configuration (line ~620)
```javascript
printer = new ThermalPrinter.printer({
  type: PrinterTypes.EPSON,
  interface: iface,
  characterSet: CharacterSet.PC437_USA,
  width: 32, // ← Added explicit width
  // ... other options
});
```

#### 2. Receipt Content (lines ~662-720)
- Shortened labels to fit width
- Added proper spacing calculations for right-aligned amounts
- Split long text into multiple lines
- Used bold() for emphasis instead of long separators

#### 3. Raw Printing Fallback (lines ~785-815)
- Same optimized format for ESC/POS raw commands
- Consistent with main printing method

## Testing

To test the new format:

1. **Go to Settings** → Click "Test Thermal Printer"
2. **Print a receipt** from the roster
3. **Check that**:
   - Text doesn't wrap or break mid-word
   - Amounts are right-aligned
   - All text fits on the paper width
   - Receipt looks clean and professional

## Common Issues & Solutions

### Text still wrapping
- Your printer might be set to 42 or 48 char width
- Adjust the `width` setting in printer configuration
- Check your printer's DIP switch settings

### Amounts not aligned
- Ensure monospace font is working
- Check character encoding (should be PC437_USA)
- Verify printer driver is "Generic / Text Only"

### Characters missing or garbled
- Try different character set (e.g., CharacterSet.PC858_EURO)
- Check printer's code page settings
- Ensure proper encoding in raw mode

## Receipt Width Reference

| Paper Size | Typical Width | Settings |
|-----------|--------------|----------|
| 58mm      | 32 chars     | Current  |
| 80mm      | 48 chars     | Modify if needed |

To change for 80mm paper, update the `width` parameter to 48 in the code.
