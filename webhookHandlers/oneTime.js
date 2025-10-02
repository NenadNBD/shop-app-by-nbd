const { retryFor } = require('../utils/retry');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const setHubSpotToken = require('../database/getTokens');
const { prepareInvoice } = require('../utils/prepareInvoice');
const FormData = require('form-data');

// Utility Function to search Contact
const searchContactByEmail = async (accessToken, email) => {
  try {
    const response = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email
            }
          ]
        }
      ],
      limit: 1,
      properties: ['hs_object_id', 'address', 'city', 'zip', 'state', 'country']
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (response.data.results.length > 0) {
      return response.data.results[0].properties; // Returns the contact ID
    } else {
      return null; // No contact found
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
};

// Utility Function to search Company
const searchCompanyByNameOrDomain = async (accessToken, { name, domain }) => {
  try {
    const response = await axios.post('https://api.hubapi.com/crm/v3/objects/companies/search', {
      filterGroups: [
        { filters: [{ propertyName: 'name', operator: 'EQ', value: name }] },
        { filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }
      ],
      limit: 1,
      properties: ['hs_object_id', 'name']
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    if (response.data.results.length > 0) {
      return response.data.results[0].properties; // Returns the contact ID
    } else {
      return null; // No contact found
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
};

// Utility Function to search Last Invoice Sufix
const searchInvoicesByYear = async (accessToken, invoice_year) => {
  try {
    const response = await axios.post('https://api.hubapi.com/crm/v3/objects/2-192773368/search', {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'invoice_year',
              operator: 'EQ',
              value: String(invoice_year)
            }
          ]
        }
      ],
      properties: ['invoice_number_sufix'],
      sorts: [{ "propertyName": "invoice_number_sufix", "direction": "DESCENDING" }],
      limit: 1
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const result = response.data?.results?.[0];
    if (!result) return null;

    const last = Number(result.properties?.invoice_number_sufix);
    return Number.isFinite(last) ? last : null;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
};


// Convert Stripe's seconds timestamp to a HubSpot date picker value
function stripeSecondsToHubSpotDatePicker(seconds) {
  const d = new Date(seconds * 1000); // seconds -> ms
  // Build midnight UTC for that calendar date
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

module.exports = {
    async onSucceeded(pi) {
      let getPortalId;
      let getPayerType;
      let getEmail;
      let getFirstName;
      let getLastName;
      let getFullName;
      let getCompanyName;
      let getAddress;
      let getCity;
      let getZip;
      let getCountry;
      let getState;
      let getPaymentMethodType;
      let getPaymentDate;
      let getProductName;
      let getAmount;
      let getContactId;
      let getCompanyId;
      let getHsProductId;
      const piCharge = await stripe.paymentIntents.retrieve(pi.id, {
        expand: ['latest_charge', 'payment_method']
      });
      const meta = pi.metadata || {};
      getPortalId = String(meta.hsPortalId || '').trim();
      getPayerType = String(meta.payerType || '').trim().toLowerCase();
      getHsProductId = String(meta.hsProductId || '').trim();
      if(getPayerType === 'individual'){
        getCompanyName = '';
      }else if(getPayerType === 'company'){
        getCompanyName = String(meta.companyName || '').trim();
      }
      getFirstName = String(meta.firstName || '').trim();
      getLastName = String(meta.lastName || '').trim();
      getFullName = String(meta.fullName || '').trim();
      getProductName = String(meta.productName || '').trim();
      const charge  = piCharge.latest_charge || null;
      getPaymentMethodType = charge.payment_method_details.type;
      getPaymentDate = charge.created;
      const billing = charge?.billing_details || {};
      if(billing){
        getEmail =  String(billing.email).trim();
      }
      getAmount = Number((pi.amount / 100).toFixed(2));
      console.log('Event Emial:', getEmail);

      // Search for Contact ID
      const tokenInfo01 = await setHubSpotToken(getPortalId);
      const ACCESS_TOKEN01 = tokenInfo01.access_token;

      // Try to find the contact for up to ~7 seconds
      const contact = await retryFor(
        () => searchContactByEmail(ACCESS_TOKEN01, getEmail),
        { maxMs: 7000, shouldRetry: (err, out) => !err && !out }
      );
      if (contact) {
        getContactId = String(contact.hs_object_id);
        getAddress = String(contact.address || '').trim();
        getCity = String(contact.city || '').trim();
        getZip = String(contact.zip || '').trim();
        getCountry = String(contact.country || '').trim();
        if(getCountry === 'United States'){
          getState = String(contact.state || '').trim();
        }else{
          getState = '';
        }
      }

      console.log('Event Contact ID:', getContactId);

      // Search for Company if Payer Type is COMPANY
      if(getPayerType === 'company'){
        const companyNameToSearch = getCompanyName.toLowerCase();
        const domain = (getEmail.includes('@') ? getEmail.split('@')[1] : '').toLowerCase();
        const tokenInfo02 = await setHubSpotToken(getPortalId);
        const ACCESS_TOKEN02 = tokenInfo02.access_token;
        const company = await searchCompanyByNameOrDomain(ACCESS_TOKEN02, { name: companyNameToSearch, domain: domain });
        console.log(company);
        // Get Company ID if exists in HubSpot
        if (company) {
          getCompanyId = String(company.hs_object_id);
          console.log('Company found:', company.name);
        // Create new Company
        }else{
          // Skip junk domains for company.domain
          const FREE_EMAIL_DOMAINS = new Set([
            'gmail.com','yahoo.com','outlook.com','hotmail.com','live.com','aol.com',
            'icloud.com','me.com','gmx.com','mail.com','proton.me','zoho.com','pm.me','yandex.com','yandex.ru'
          ]);
          const isFree = FREE_EMAIL_DOMAINS.has(domain);
          // Build properties (send at least name or a non-freemal domain)
          const properties = {};
          if (getCompanyName){
            properties.name = getCompanyName;
          }
          if (domain && !isFree){
            properties.domain = domain;
          }
          if (getAddress){
            properties.address = getAddress;
          }
          if (getCity){
            properties.city = getCity;
          }
          if (getZip){
            properties.zip = getZip;
          }
          if (getState){
            properties.state = getState;
          }
          if (getCountry){
            properties.country = getCountry;
          }
          const createCompanyUrl = 'https://api.hubapi.com/crm/v3/objects/companies';
          const createCompanyBody = {
            properties,
            associations: getContactId ? [{
              to: { id: getContactId },
              types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 5 }]
            }] : undefined
          };
          const tokenInfo03 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN03 = tokenInfo03.access_token;
          const createCompanyOptions = {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN03}`, 
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(createCompanyBody)
          };
          try {
            const createCompanyResponse = await fetch(createCompanyUrl, createCompanyOptions);
            const createCompanyData = await createCompanyResponse.json();
            if (!createCompanyResponse.ok) {
              console.error('Company create failed:', createCompanyResponse.status, createCompanyData);
            } else {
              getCompanyId = createCompanyData.id
              console.log('Company created');
            }
          } catch (error) {
            console.error(error);
          }
        }
      }

      // Prepare Deal
      const createDealUrl = 'https://api.hubapi.com/crm/v3/objects/0-3';
      let setDealStage = '3317387474'
      let setDealName;
      if(getPayerType === 'company'){
        setDealName = getCompanyName + ' - ' + getProductName;
      }else if(getPayerType === 'individual'){
        setDealName = getFullName + ' - ' + getProductName;
      }
      const dealCloseDate = Date.now();
      const dealOwner = '44516880';
      const dealAmount = getAmount;
      const dealBody = {
        properties: {
          amount: dealAmount,
          closedate: dealCloseDate,
          dealname: setDealName,
          pipeline: '2428974327',
          dealstage: setDealStage,
          hubspot_owner_id: dealOwner,
        },
        associations: []
      };
      if (getContactId) {
        dealBody.associations.push({
          to: { id: String(getContactId) },
          types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 3 }]
        });
      }
      if (getPayerType === 'company' && getCompanyId) {
        dealBody.associations.push({
          to: { id: String(getCompanyId) },
          types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 1 }]
        });
      }
      // Create Deal
      const tokenInfoDeal1 = await setHubSpotToken(getPortalId);
      const ACCESS_TOKEN_DEAL1 = tokenInfoDeal1.access_token;
      const createDealOptions = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN_DEAL1}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dealBody)
      };
      try {
        const dealRes = await fetch(createDealUrl, createDealOptions);
        const dealData = await dealRes.json();
        if (!dealRes.ok) {
          console.error('Deal create failed:', dealRes.status, dealData);
        } else {
          console.log('Deal created');
        }
      } catch (err) {
        console.error('Fetch error creating deal:', err);
      }
      // ----- Create Invoice PDF and Invoice Custom Object -----
      // 1 Search previous Invoices to get Invoice Sufix
      const tokenInv01 = await setHubSpotToken(getPortalId);
      const ACCESS_TOKEN_INV_01 = tokenInv01.access_token;
      const invoiceYear = new Date().getFullYear();
      const startSuffix = 1000;
      const lastInvoiceSuffix = await searchInvoicesByYear(ACCESS_TOKEN_INV_01, invoiceYear);
      console.log(lastInvoiceSuffix);
      const setInvoiceSuffix = lastInvoiceSuffix != null ? lastInvoiceSuffix + 1 : startSuffix;

      // 2 Create Invoice Body
      let setBillToName;
      if(getPayerType === 'company'){
        setBillToName = getCompanyName;
      }else if(getPayerType === 'individual'){
        setBillToName = getFullName;
      }
      const paymentMethodLabels = {
        card: 'Card',
        google_pay: 'GooglePay',   // as you prefer (no space)
        apple_pay: 'Apple Pay',
        us_bank_account: 'US Bank Account'
      };


      const printInvoice = {
        invoice_number: `INV-${invoiceYear}-${setInvoiceSuffix}`,
        issue_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
        due_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
        statement_descriptor: "Stripe",
        payment_id: String(pi.id || ''),
        payment_method: paymentMethodLabels[getPaymentMethodType] ?? getPaymentMethodType,
        status: "Paid",
        subtotal: getAmount,
        tax: 0.00,
        total: getAmount,
        amount_paid: getAmount,
        balance_due: 0.00,
        seller: {
          name: "No Bounds Digital",
          address_line1: "328 W High St",
          city: "Elizabethtown",
          state: "Pennsylvania",
          postal_code: "17022",
          country: "United States",
          email: "nenad@noboundsdigital"
        },
        bill_to: {
          name: setBillToName,
          email: getEmail,
          address_line1: getAddress,
          city: getCity,
          state: getState,
          postal_code: getZip,
          country: getCountry
        },
        line_items: [
          { name: getProductName, quantity: 1, unit_price: getAmount, type: 'purchase', billing_cycle: 'September 30 2025 - October 30 2025' },
          // { name: "Support", description: "Sep 28–Oct 28", quantity: 1, unit_price: 49.00 },
        ],
        // You can compute these or pass them precomputed
      };

      // 1 Build PDF (Buffer)
      const createPdf = new FormData();
      const pdfDataUri = await prepareInvoice(printInvoice);
      let pdfData = pdfDataUri.replaceAll("data:application/pdf;filename=generated.pdf;base64,","");
      pdfData = pdfData.replaceAll('"', '');
      const buffer = Buffer.from(pdfData, "base64")

      // 2 Upload to HubSpot Files using folderId
      const fileName = `INV-${invoiceYear}-${setInvoiceSuffix}.pdf`;
      createPdf.append('fileName', fileName);
      createPdf.append('file', buffer, fileName);
      createPdf.append('options', JSON.stringify({
        "access":  "PUBLIC_NOT_INDEXABLE",
        "overwrite": false
      }));
      createPdf.append('folderId', '282220027069');
      
      /* INSERT PDF INTO FILES */
      const tokenPdf01 = await setHubSpotToken(getPortalId);
      const ACCESS_TOKEN_PDF_01 = tokenPdf01.access_token;
      const client =  axios.create({
        baseURL: 'https://api.hubapi.com',
        headers: { 
          accept: 'application/json', 
          Authorization: `Bearer ${ACCESS_TOKEN_PDF_01}`
        }
      });
      
      let getPdfId;
      let getPdfUrl;

      try {
        const ApiResponse2 = await client.post('/files/v3/files', createPdf, {
          headers: createPdf.getHeaders()
        });
        getPdfId = ApiResponse2.data.id;
        getPdfUrl = ApiResponse2.data.url;
      } catch (err) {
        console.error(err);
        throw err;
      }
      console.log('File uploaded!');
      console.log(getPdfId);
      console.log(getPdfUrl);


      const invoiceBody = {
        properties: {
          invoice_year: invoiceYear,
          invoice_number_sufix: setInvoiceSuffix,
          invoice_number: `INV-${invoiceYear}-${setInvoiceSuffix}`,
          issue_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
          due_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
          status: 'Paid',
          statement_descriptor: 'Stripe',
          transaction_type: 'Purchase',
          payment_id: String(pi.id || ''),
          payment_method: paymentMethodLabels[getPaymentMethodType] ?? getPaymentMethodType,
          product: getProductName,
          quantity: 1,
          amount_subtotal: getAmount,
          amount_due: getAmount,
          amount_total: getAmount,
          bill_to_name: setBillToName,
          bill_to_email: getEmail,
          bill_to_address: getAddress,
          bill_to_city: getCity,
          bill_to_postal_code: getZip,
          bill_to_state: getState,
          bill_to_country: getCountry,
        }
      };
      console.log('Invoice Body:');
      console.log(invoiceBody.properties);

      const createInvoiceUrl = 'https://api.hubapi.com/crm/v3/objects/2-192773368';
      const tokenInv02 = await setHubSpotToken(getPortalId);
      const ACCESS_TOKEN_INV_02 = tokenInv02.access_token;
      const createInvoiceOptions = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN_INV_02}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(invoiceBody)
      };
      try {
        const invoiceRes = await fetch(createInvoiceUrl, createInvoiceOptions);
        const invoiceData = await invoiceRes.json();
        if (!invoiceRes.ok) {
          console.error('Invoice create failed:', invoiceRes.status, invoiceData);
        } else {
          console.log('Deal created');
        }
      } catch (err) {
        console.error('Fetch error creating deal:', err);
      }

      const testNoteUrl = 'https://api.hubapi.com/crm/v3/objects/notes/303013058807';
      const testNoteOptions = {method: 'GET', headers: {Authorization: `Bearer ${ACCESS_TOKEN_INV_02}`}};

      try {
        const response = await fetch(testNoteUrl, testNoteOptions);
        const data = await response.json();
        console.log('Note DATA TEST:');
        console.log(data);
      } catch (error) {
        console.error(error);
      }

    },
    async onFailed(pi) {
      // Mark failed
    },
  };