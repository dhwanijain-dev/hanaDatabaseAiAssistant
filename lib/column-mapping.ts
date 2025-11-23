/**
 * Column mapping from old sales table to new sales table
 * This allows the chatbot to work with the new column names
 */

export const COLUMN_MAPPING = {
  // Old name -> New name
  bill_no: 'Invoice No.',
  billing_date: 'Invoice Date',
  billing_type: 'Billing Doc. Type',
  Amount: 'Final Amount(INR)',
  MATNR: 'Material Code',
  mat_description: 'Description',
  country: 'Country',
  company_code: null, // Not in new table
  coustmer_code: 'Customer Code',
  Division: null, // Not in new table
  Plant: 'Plant',
  currency: null, // Not in new table (implied INR)
  state_code: 'State Of Customer',
} as const;

export const NEW_COLUMN_NAMES = {
  // Primary fields for chatbot
  invoiceNumber: 'Invoice No.',
  invoiceDate: 'Invoice Date',
  year: 'YEAR',
  month: 'MONTH',
  amount: 'Final Amount(INR)',
  taxableValue: 'Taxable Value (INR)',
  materialCode: 'Material Code',
  description: 'Description',
  customerCode: 'Customer Code',
  customerName: 'Customer Name',
  customerCity: 'Customer City',
  plant: 'Plant',
  country: 'Country',
  state: 'State Of Customer',
  
  // Sales details
  salesOrderNo: 'Sales Order No.',
  salesOrderDate: 'Sales Order Date',
  invoiceQuantity: 'Invoice Quantity',
  netWeight: 'Net Weight in Kg',
  salesUnit: 'Sales Unit',
  perUnitPrice: 'Per Unit Price (INR)',
  
  // Additional fields
  salesManager: 'Sales Manager',
  materialGroup: 'Material Group',
  billingDocType: 'Billing Doc. Type',
  salesDistrict: 'Sales District',
  region: 'Region Description',
  
  // Tax fields
  gst: 'Interstate GST',
  cgst: 'Central GST',
  
  // Other
  truckNo: 'Truck No.',
  deliveryNo: 'Delivery No.',
} as const;

// Columns to select for different query types
export const QUERY_COLUMNS = {
  TABLE: [
    'Invoice No.',
    'Invoice Date',
    'Final Amount(INR)',
    'Material Code',
    'Description',
    'Customer Name',
    'Customer City',
    'Plant',
    'Sales Manager',
  ],
  
  CHART: [
    'Invoice Date',
    'YEAR',
    'MONTH',
    'Final Amount(INR)',
    'Material Code',
    'Country',
    'Plant',
    'Billing Doc. Type',
  ],
  
  FULL: Object.values(NEW_COLUMN_NAMES),
} as const;

// Helper to quote identifiers with spaces
export const quoteColumn = (col: string) => `"${col.replace(/"/g, '""')}"`;

// Get select string for a query type
export const getSelectString = (type: keyof typeof QUERY_COLUMNS = 'TABLE') => {
  return QUERY_COLUMNS[type].map(quoteColumn).join(', ');
};
