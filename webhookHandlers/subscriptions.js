// handlers/subscriptions.js
const { retryFor } = require('../utils/retry');
const axios = require('axios');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const setHubSpotToken = require('../database/getTokens');
const { countryName, usStateName } = require('../utils/geo');
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

function formatInvoiceDate(ms) {
  const d = new Date(ms); // hubspotDateMs
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC', // ensure no timezone shifts
  }).format(d);
}
  let checkSubscriptionType = '';
  module.exports = {
    // Lifecycle updates: trialing -> active -> past_due -> canceled …
    async onSubscriptionEvent(event) {
      const sub = event.data.object;
      checkSubscriptionType = String(sub.status || '');
      console.log('LOG HERE MAIN SUBSCRIPTION TYPE:',checkSubscriptionType);
      // sub.status: trialing | active | past_due | canceled | incomplete | incomplete_expired | unpaid | paused
      // sub.metadata.flow: 'trial' | 'pay_now' (if you set this on create)
      switch (event.type) {
        case 'customer.subscription.created':
          // ----- TRIAL ---
          if (sub.status === 'trialing') {
            console.log(sub.status);
            let getLatestInvoice = String(sub.latest_invoice || '');
            let getTrialStart = Number(sub.trial_start * 1000);
            let getTrialEnd = Number(sub.trial_end * 1000);
            let setTrialStart = stripeSecondsToHubSpotDatePicker(getTrialStart);
            let setTrialEnd = stripeSecondsToHubSpotDatePicker(getTrialEnd);
            const trialInvoice = await stripe.invoices.retrieve(getLatestInvoice);
            console.log('Log Whole Invoice Object!!!');
            console.log(trialInvoice);


            let getContactId;
            let getEmail = String(trialInvoice.subscription_details.metadata.email || '').trim();
            let getFullName = String(trialInvoice.subscription_details.metadata.full_name || '').trim();
            let getAddress = String(trialInvoice.customer_address.line1 || '').trim();
            let getCity = String(trialInvoice.customer_address.city || '').trim();
            let getZip = String(trialInvoice.customer_address.postal_code || '').trim();
            let getState = String(trialInvoice.customer_address.state || '').trim();
            let getCountry = String(trialInvoice.customer_address.country || '').trim();
            let setState = getCountry.toUpperCase() === 'US' ? usStateName(getState) : getCountry || '';
            let setCountry = countryName(getCountry);
            let getCompanyName = String(trialInvoice.subscription_details.metadata.company || '').trim();
            let getCompanyId;
            let getPortalId = String(trialInvoice.subscription_details.metadata.hsPortalId || '').trim();
            let getPayerType = String(trialInvoice.subscription_details.metadata.payer_type || '').trim();
            let getProductName = String(trialInvoice.subscription_details.metadata.product_name || '').trim();
            let getSripeCustomerId = String(trialInvoice.customer || '').trim();
            let getStripeSubscriptionId = String(trialInvoice.subscription || '').trim();
            let getStripeSubscriptionStatus = 'trialing';
            let getPaymentDate = Number(trialInvoice.created);
            let getAmount = 0.00;
            const paymentIntentId = String(trialInvoice.payment_intent || '').trim();
            const getChargeId = String(trialInvoice.charge || '').trim();;
            const charge = await stripe.charges.retrieve(getChargeId);
            let getPaymentMethodType = String(charge.payment_method_details.type || '').trim();

            // ----- 01 Search HubSpot for Contact ID -----
            const tokenInfo01 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN01 = tokenInfo01.access_token;
            // Try to find the contact for up to ~7 seconds
            const contact = await retryFor(
              () => searchContactByEmail(ACCESS_TOKEN01, getEmail),
              { maxMs: 7000, shouldRetry: (err, out) => !err && !out }
            );
            if (contact) {
              getContactId = String(contact.hs_object_id);
            }

            // ----- 02 Search HubSpot for Company ID if Payer Type is "company". If not found, create Company and associate it to Contact -----
            if(getPayerType === 'company' && getCompanyName){
              const companyNameToSearch = getCompanyName.toLowerCase();
              const emailForCompany = getEmail;
              const domain = (emailForCompany.includes('@') ? emailForCompany.split('@')[1] : '').toLowerCase();
              const tokenInfo02 = await setHubSpotToken(getPortalId);
              const ACCESS_TOKEN02 = tokenInfo02.access_token;
              const company = await searchCompanyByNameOrDomain(ACCESS_TOKEN02, { name: companyNameToSearch, domain: domain });
              // Company Founded
              if (company) {
                getCompanyId = String(company.hs_object_id);
                console.log('Company found:', company.name);
              // Create New Company
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
                    getCompanyId = String(createCompanyData.id);
                    console.log('Company created');
                  }
                } catch (error) {
                  console.error(error);
                }
              }
            }

            // ----- 03 Update Stripe Customer and Subscription with HubSpot Contact and Company IDs as metadata for future use -----
            let setHsContactIdMeta = getContactId;
            let setHsCompanyMeta;
            if(getPayerType === 'company'){
              setHsCompanyMeta = getCompanyId
            }else{
              setHsCompanyMeta = '';
            }

            await stripe.customers.update(getSripeCustomerId, {
              metadata: {
                hsContactId: String(setHsContactIdMeta),
                hsCompanyId: String(setHsCompanyMeta),
              },
            });
            await stripe.subscriptions.update(getStripeSubscriptionId, {
              metadata: {
                hsContactId: String(setHsContactIdMeta),
                hsCompanyId: String(setHsCompanyMeta),
              },
            });

            // ----- 04 Create Deal -----
            // Prepare Deal
            const createDealUrl = 'https://api.hubapi.com/crm/v3/objects/0-3';
            let setDealStage = '3311151350';
            let setDealName;
            if(getPayerType === 'company'){
              setDealName = getCompanyName + ' - ' + getProductName;
            }else if(getPayerType === 'individual'){
              setDealName = getFullName + ' - ' + getProductName;
            }
            const dealOwner = '44516880';
            const dealBody = {
              properties: {
                amount: getAmount,
                closedate: Number(getPaymentDate * 1000),
                dealname: setDealName,
                pipeline: '2399805635',
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
            let getDealId;
            const tokenInfoDeal2 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_DEAL2 = tokenInfoDeal2.access_token;
            const createDealOptions = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_DEAL2}`,
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
                getDealId = String(dealData.id);
                console.log('Deal created');
              }
            } catch (err) {
              console.error('Fetch error creating deal:', err);
            }

            // ----- 05 Update Stripe Customer and Subscription with HubSpot Deal ID as metadata for future use -----
            await stripe.customers.update(getSripeCustomerId, {
              metadata: {
                hsDealId: String(getDealId),
              },
            });
            await stripe.subscriptions.update(getStripeSubscriptionId, {
              metadata: {
                hsDealId: String(getDealId),
              },
            });

            // ----- 06 Insert Subscription in HubDB and publish it -----
            const hubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows';
            const publishHubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/draft/publish';

            // Insert Subscription in HubDb
            const tokenInfoAct1 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_ACT1 = tokenInfoAct1.access_token;
            const hubDbOptions = {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ACCESS_TOKEN_ACT1}`, 
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  values: {
                    contact_email: getEmail,
                    contact_id: getContactId,
                    customer_id: getSripeCustomerId,
                    subscription_id: getStripeSubscriptionId,
                    subscription_name: getProductName,
                    subscription_status: { name: getStripeSubscriptionStatus, type: 'option' },
                    current_period_end: getTrialEnd
                  }
                })
              };
              try {
              const hubDbResponse = await fetch(hubDbUrl, hubDbOptions);
              const hubDbData = await hubDbResponse.json();
              // Publish HubDb
              if(hubDbData){
                  const tokenInfoAct2 = await setHubSpotToken(getPortalId);
                  const ACCESS_TOKEN_ACT2 = tokenInfoAct2.access_token;
                  const publishHubDboptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_ACT2}`}};
                  try {
                      const publishHubDbResponse = await fetch(publishHubDbUrl, publishHubDboptions);
                      const publishHubDbData = await publishHubDbResponse.json();
                      if(publishHubDbData){
                          console.log('Subscription inserted and published in HubDB')
                      }
                  } catch (error) {
                  console.error(error);
                  }
                }
              } catch (error) {
              console.error(error);
              }

            // ----- 07 Create Invoice PDF and Invoice Custom Object for ACTIVE SUBSCRIPTION -----
            // 1 Search previous Invoices to get Invoice Sufix
            const tokenInv01 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_INV_01 = tokenInv01.access_token;
            const invoiceYear = new Date().getFullYear();
            const startSuffix = 1000;
            const lastInvoiceSuffix = await searchInvoicesByYear(ACCESS_TOKEN_INV_01, invoiceYear);
            console.log(lastInvoiceSuffix);
            const setInvoiceSuffix = lastInvoiceSuffix != null ? lastInvoiceSuffix + 1 : startSuffix;
            
            // 2 Prepare Invoice Body
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
            let stringActiveBillingCycle = `Trial: ${formatInvoiceDate(setTrialStart) ?? ''} - ${formatInvoiceDate(setTrialEnd) ?? ''}`;

            // 3 Prepare Body to print Invoice PDF
            const printInvoice = {
              invoice_number: `INV-${invoiceYear}-${setInvoiceSuffix}`,
              issue_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
              due_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
              statement_descriptor: "Stripe",
              payment_id: paymentIntentId,
              payment_method: paymentMethodLabels[getPaymentMethodType] ?? getPaymentMethodType,
              status: "Trialing",
              subtotal: 0.00,
              tax: 0.00,
              total: 0.00,
              amount_paid: 0.00,
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
                state: setState,
                postal_code: getZip,
                country: setCountry
              },
              line_items: [
                { name: getProductName, quantity: 1, unit_price: getAmount, type: 'subscription', billing_cycle: stringActiveBillingCycle },
                // { name: "Support", description: "Sep 28–Oct 28", quantity: 1, unit_price: 49.00 },
              ],
              // You can compute these or pass them precomputed
            };

            // 4 Build PDF (Buffer)
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
            createPdf.append('folderId', '282421374140');
            
            // 5 Insert PDF into Files
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
            let setPdfUrl = getPdfUrl.replace('https://146896786.fs1.hubspotusercontent-eu1.net', 'https://nbd-shop.nenad-code.dev');
            
            
            // ----- 08 Create Record in Custom Object INVOICE -----
            // 6 Prepare Invoice Custom Object Body
            const invoiceBody = {
              properties: {
                invoice_year: invoiceYear,
                invoice_number_sufix: setInvoiceSuffix,
                invoice_number: `INV-${invoiceYear}-${setInvoiceSuffix}`,
                issue_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
                due_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
                status: 'Trialing',
                statement_descriptor: 'Stripe',
                transaction_type: 'Subscription',
                payment_id: paymentIntentId,
                payment_method: paymentMethodLabels[getPaymentMethodType] ?? getPaymentMethodType,
                product: getProductName,
                quantity: 1,
                amount_subtotal: 0.00,
                amount_due: 0.00,
                amount_total: 0.00,
                bill_to_name: setBillToName,
                bill_to_email: getEmail,
                bill_to_address: getAddress,
                bill_to_city: getCity,
                bill_to_postal_code: getZip,
                bill_to_state: setState,
                bill_to_country: setCountry,
                stripe_customer_id: getSripeCustomerId,
                stripe_subscription_id: getStripeSubscriptionId,
                contact_id: getContactId,
                printed_invoice_id: getPdfId,
                printed_invoice_url: setPdfUrl,
              }
            };
            console.log('Invoice Body:');
            console.log(invoiceBody.properties);

            // 7 Create Invoice Custom Object Record
            const createInvoiceUrl = 'https://api.hubapi.com/crm/v3/objects/2-192773368';
            const tokenInv02 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_INV_02 = tokenInv02.access_token;
            let getInvoiceId;
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
              getInvoiceId = invoiceData.id;
              if (!invoiceRes.ok) {
                console.error('Invoice create failed:', invoiceRes.status, invoiceData);
              } else {
                console.log('Deal created');
              }
            } catch (err) {
              console.error('Fetch error creating deal:', err);
            }

            // 8 Create Note for Invoice Custom Object Record and associte to it Invoice PDF
            const noteUrl = 'https://api.hubapi.com/crm/v3/objects/notes';
            let createNoteBody = '<div style="" dir="auto" data-top-level="true"><p style="margin:0;"><strong><span style="color: #151E21;">INV-' + invoiceYear + '-' + setInvoiceSuffix + '</span></strong></p></div>';
            const noteBody = {
              properties: {
                hs_timestamp: Number(getPaymentDate * 1000),
                hs_note_body: createNoteBody,
                hubspot_owner_id: dealOwner,
                hs_attachment_ids: getPdfId
              },
              associations: [
                {
                  to: {
                    id: getInvoiceId
                  },
                  types: [
                    {
                      associationCategory: "USER_DEFINED",
                      associationTypeId: 14
                    } 
                  ]
                }
              ]
            };
            const tokenNote01 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_NOTE_01 = tokenNote01.access_token;
            const createNoteOptions = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_NOTE_01}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(noteBody)
            };
            
            try {
              const noteResponse = await fetch(noteUrl, createNoteOptions);
              const noteData = await noteResponse.json();
              if(noteData){
                console.log('Note is created and associated with Invoice PDF to Invoice Object');
              }
            } catch (error) {
              console.error(error);
            }

            //----- Associate Invoice Custom Object to Contact ---
            const invoiceToContactUrl = 'https://api.hubapi.com/crm/v4/objects/2-192773368/' + getInvoiceId + '/associations/contacts/' + getContactId;
            const tokenAssociation01 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_ASSOCIATION_01 = tokenAssociation01.access_token;
            const invoiceToContactOptions = {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_ASSOCIATION_01}`, 
                'Content-Type': 'application/json'
              },
              body: JSON.stringify([
                { associationCategory: 'USER_DEFINED', associationTypeId:26 }
              ])
            };
            try {
              const invoiceToContactRes = await fetch(invoiceToContactUrl, invoiceToContactOptions);
              const invoiceToContactData = await invoiceToContactRes.json();
              if(invoiceToContactData){
                console.log('Invoice is associated to Contact');
              }
            } catch (error) {
              console.error(error);
            }

            //----- Associate Invoice Custom Object to Company ---
            if(getPayerType === 'company' && getCompanyId){
              const invoiceToCompanyUrl = 'https://api.hubapi.com/crm/v4/objects/2-192773368/' + getInvoiceId + '/associations/companies/' + getCompanyId;
              const tokenAssociation02 = await setHubSpotToken(getPortalId);
              const ACCESS_TOKEN_ASSOCIATION_02 = tokenAssociation02.access_token;
              const invoiceToCompanyOptions = {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${ACCESS_TOKEN_ASSOCIATION_02}`, 
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify([
                  { associationCategory: 'USER_DEFINED', associationTypeId:30 }
                ])
              };
              try {
                const invoiceToCompanyRes = await fetch(invoiceToCompanyUrl, invoiceToCompanyOptions);
                const invoiceToCompanyData = await invoiceToCompanyRes.json();
                if(invoiceToCompanyData){
                  console.log('Invoice is associated to Company');
                }
              } catch (error) {
                console.error(error);
              }
            }

            //----- Update Contact to get Membership and with PDF data to send Marketing Email
            const updateContactWithPdfUrl = 'https://api.hubapi.com/crm/v3/objects/contacts/' + getContactId;
            const updateContactWithPdfBody = {
              properties: {
                invoice_number: String('INV-' + invoiceYear + '-' + setInvoiceSuffix),
                invoice_pdf_url: setPdfUrl,
                invoice_pdf_id: getPdfId,
                has_subscriptions: 'Yes',
              },
            };
            const tokenUpdateContactWithPdf = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_UPDATE_CONTACT_WITH_PDF = tokenUpdateContactWithPdf.access_token;
            const updateContactWithPdfOptions = {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_UPDATE_CONTACT_WITH_PDF}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(updateContactWithPdfBody)
            };

            try {
              const updateContactWithPdfRes = await fetch(updateContactWithPdfUrl, updateContactWithPdfOptions);
              const updateContactWithPdfData = await updateContactWithPdfRes.json();
              if(updateContactWithPdfData){
                console.log('Contact is ready to send Invoice Marketing Email');
              }
            } catch (error) {
              console.error(error);
            }
          // ----- ACTIVE ---
          } else if (sub.status === 'active') {
            console.log('Proceed to ON INVOICE EVENT');
          // ----- INCOMPLETE ---
          } else if (sub.status === 'incomplete') {
            console.log('SUBSCRIPTION IS INCOMPLETE. WILL BE PAYED?');
          }
          break;
  
        case 'customer.subscription.updated':
          // react to status changes (trial -> active; past_due; paused/resumed, etc.)
          break;
  
        case 'customer.subscription.deleted':
          // canceled by you or customer
          break;
  
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
          // optional pause/resume logic
          break;
      }
    },
  
    // Invoices: both first invoice (subscription_create) and renewals (subscription_cycle)
    async onInvoiceEvent(event) {
      const invoice = event.data.object;
  
      // Keys you’ll often use:
      // invoice.billing_reason: 'subscription_create' | 'subscription_cycle' | 'subscription_threshold' | 'manual'
      // invoice.subscription: sub ID
      // invoice.amount_paid / amount_due (minor units)
      // const firstLine = invoice.lines?.data?.[0];
      // const priceId = firstLine?.price?.id;
      // const productId = firstLine?.price?.product;
      console.log('Monitor Subscription Invoices');
  
      if (event.type === 'invoice.payment_succeeded' && checkSubscriptionType === 'active') {
        if (invoice.billing_reason === 'subscription_create') {
          // First charge for a non-trial sub (pay-first flow)
          // Or $0 invoice for trial start (rare; usually no invoice is generated at trial start)
          // Mark subscription as active/paid in your system
          console.log('New Subscription is PAYED!');
          
          let getContactId;
          let getEmail = String(invoice.subscription_details.metadata.email || '').trim();
          let getFullName = String(invoice.subscription_details.metadata.full_name || '').trim();
          let getAddress = String(invoice.customer_address.line1 || '').trim();
          let getCity = String(invoice.customer_address.city || '').trim();
          let getZip = String(invoice.customer_address.postal_code || '').trim();
          let getState = String(invoice.customer_address.state || '').trim();
          let getCountry = String(invoice.customer_address.country || '').trim();
          let setState = getCountry.toUpperCase() === 'US' ? usStateName(getState) : getCountry || '';
          let setCountry = countryName(getCountry);
          let getCompanyName = String(invoice.subscription_details.metadata.company || '').trim();
          let getCompanyId;
          let getPortalId = String(invoice.subscription_details.metadata.hsPortalId || '').trim();
          let getPayerType = String(invoice.subscription_details.metadata.payer_type || '').trim();
          let getProductName = String(invoice.subscription_details.metadata.product_name || '').trim();
          let getSripeCustomerId = String(invoice.customer || '').trim();
          let getStripeSubscriptionId = String(invoice.subscription || '').trim();
          let getStripeSubscriptionStatus = 'active';
          let getCurrentPeriodStart = Number(invoice.lines.data[0].period.start * 1000);
          let setCurrentPeriodStart = stripeSecondsToHubSpotDatePicker(invoice.lines.data[0].period.start);
          let getCurrentPeriodEnd = Number(invoice.lines.data[0].period.end * 1000);
          let setCurrentPeriodEnd = stripeSecondsToHubSpotDatePicker(invoice.lines.data[0].period.end);
          let getPaymentDate = Number(invoice.created);
          let getAmount = Number((invoice.amount_paid / 100).toFixed(2));
          const paymentIntentId = String(invoice.payment_intent || '').trim();
          const getChargeId = String(invoice.charge || '').trim();;
          const charge = await stripe.charges.retrieve(getChargeId);
          let getPaymentMethodType = String(charge.payment_method_details.type || '').trim();

          // ----- 01 Search HubSpot for Contact ID -----
          const tokenInfo01 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN01 = tokenInfo01.access_token;
          // Try to find the contact for up to ~7 seconds
          const contact = await retryFor(
            () => searchContactByEmail(ACCESS_TOKEN01, getEmail),
            { maxMs: 7000, shouldRetry: (err, out) => !err && !out }
          );
          if (contact) {
            getContactId = String(contact.hs_object_id);
          }

          // ----- 02 Search HubSpot for Company ID if Payer Type is "company". If not found, create Company and associate it to Contact -----
          if(getPayerType === 'company' && getCompanyName){
            const companyNameToSearch = getCompanyName.toLowerCase();
            const emailForCompany = getEmail;
            const domain = (emailForCompany.includes('@') ? emailForCompany.split('@')[1] : '').toLowerCase();
            const tokenInfo02 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN02 = tokenInfo02.access_token;
            const company = await searchCompanyByNameOrDomain(ACCESS_TOKEN02, { name: companyNameToSearch, domain: domain });
            // Company Founded
            if (company) {
              getCompanyId = String(company.hs_object_id);
              console.log('Company found:', company.name);
            // Create New Company
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
                  getCompanyId = String(createCompanyData.id);
                  console.log('Company created');
                }
              } catch (error) {
                console.error(error);
              }
            }
          }

          // ----- 03 Update Stripe Customer and Subscription with HubSpot Contact and Company IDs as metadata for future use -----
          let setHsContactIdMeta = getContactId;
          let setHsCompanyMeta;
          if(getPayerType === 'company'){
            setHsCompanyMeta = getCompanyId
          }else{
            setHsCompanyMeta = '';
          }

          await stripe.customers.update(getSripeCustomerId, {
            metadata: {
              hsContactId: String(setHsContactIdMeta),
              hsCompanyId: String(setHsCompanyMeta),
            },
          });
          await stripe.subscriptions.update(getStripeSubscriptionId, {
            metadata: {
              hsContactId: String(setHsContactIdMeta),
              hsCompanyId: String(setHsCompanyMeta),
            },
          });

          // ----- 04 Create Deal -----
          // Prepare Deal
          const createDealUrl = 'https://api.hubapi.com/crm/v3/objects/0-3';
          let setDealStage = '3311151352';
          let setDealName;
          if(getPayerType === 'company'){
            setDealName = getCompanyName + ' - ' + getProductName;
          }else if(getPayerType === 'individual'){
            setDealName = getFullName + ' - ' + getProductName;
          }
          const dealOwner = '44516880';
          const dealBody = {
            properties: {
              amount: getAmount,
              closedate: Number(getPaymentDate * 1000),
              dealname: setDealName,
              pipeline: '2399805635',
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
          let getDealId;
          const tokenInfoDeal2 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_DEAL2 = tokenInfoDeal2.access_token;
          const createDealOptions = {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN_DEAL2}`,
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
              getDealId = String(dealData.id);
              console.log('Deal created');
            }
          } catch (err) {
            console.error('Fetch error creating deal:', err);
          }

          // ----- 05 Update Stripe Customer and Subscription with HubSpot Deal ID as metadata for future use -----
          await stripe.customers.update(getSripeCustomerId, {
            metadata: {
              hsDealId: String(getDealId),
            },
          });
          await stripe.subscriptions.update(getStripeSubscriptionId, {
            metadata: {
              hsDealId: String(getDealId),
            },
          });

          // ----- 06 Insert Subscription in HubDB and publish it -----
          const hubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows';
          const publishHubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/draft/publish';

          // Insert Subscription in HubDb
          const tokenInfoAct1 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_ACT1 = tokenInfoAct1.access_token;
          const hubDbOptions = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_ACT1}`, 
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                values: {
                  contact_email: getEmail,
                  contact_id: getContactId,
                  customer_id: getSripeCustomerId,
                  subscription_id: getStripeSubscriptionId,
                  subscription_name: getProductName,
                  subscription_status: { name: getStripeSubscriptionStatus, type: 'option' },
                  current_period_end: getCurrentPeriodEnd
                }
              })
            };
            try {
            const hubDbResponse = await fetch(hubDbUrl, hubDbOptions);
            const hubDbData = await hubDbResponse.json();
            // Publish HubDb
            if(hubDbData){
                const tokenInfoAct2 = await setHubSpotToken(getPortalId);
                const ACCESS_TOKEN_ACT2 = tokenInfoAct2.access_token;
                const publishHubDboptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_ACT2}`}};
                try {
                    const publishHubDbResponse = await fetch(publishHubDbUrl, publishHubDboptions);
                    const publishHubDbData = await publishHubDbResponse.json();
                    if(publishHubDbData){
                        console.log('Subscription inserted and published in HubDB')
                    }
                } catch (error) {
                console.error(error);
                }
              }
            } catch (error) {
            console.error(error);
            }

          // ----- 07 Create Invoice PDF and Invoice Custom Object for ACTIVE SUBSCRIPTION -----
          // 1 Search previous Invoices to get Invoice Sufix
          const tokenInv01 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_INV_01 = tokenInv01.access_token;
          const invoiceYear = new Date().getFullYear();
          const startSuffix = 1000;
          const lastInvoiceSuffix = await searchInvoicesByYear(ACCESS_TOKEN_INV_01, invoiceYear);
          console.log(lastInvoiceSuffix);
          const setInvoiceSuffix = lastInvoiceSuffix != null ? lastInvoiceSuffix + 1 : startSuffix;
          
          // 2 Prepare Invoice Body
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
          let stringActiveBillingCycle = `${formatInvoiceDate(setCurrentPeriodStart) ?? ''} - ${formatInvoiceDate(setCurrentPeriodEnd) ?? ''}`;

          // 3 Prepare Body to print Invoice PDF
          const printInvoice = {
            invoice_number: `INV-${invoiceYear}-${setInvoiceSuffix}`,
            issue_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
            due_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
            statement_descriptor: "Stripe",
            payment_id: paymentIntentId,
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
              state: setState,
              postal_code: getZip,
              country: setCountry
            },
            line_items: [
              { name: getProductName, quantity: 1, unit_price: getAmount, type: 'subscription', billing_cycle: stringActiveBillingCycle },
              // { name: "Support", description: "Sep 28–Oct 28", quantity: 1, unit_price: 49.00 },
            ],
            // You can compute these or pass them precomputed
          };

          // 4 Build PDF (Buffer)
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
          createPdf.append('folderId', '282421374140');
          
          // 5 Insert PDF into Files
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
          let setPdfUrl = getPdfUrl.replace('https://146896786.fs1.hubspotusercontent-eu1.net', 'https://nbd-shop.nenad-code.dev');
          
          
          // ----- 08 Create Record in Custom Object INVOICE -----
          // 6 Prepare Invoice Custom Object Body
          const invoiceBody = {
            properties: {
              invoice_year: invoiceYear,
              invoice_number_sufix: setInvoiceSuffix,
              invoice_number: `INV-${invoiceYear}-${setInvoiceSuffix}`,
              issue_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
              due_date: stripeSecondsToHubSpotDatePicker(getPaymentDate),
              status: 'Paid',
              statement_descriptor: 'Stripe',
              transaction_type: 'Subscription',
              payment_id: paymentIntentId,
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
              bill_to_state: setState,
              bill_to_country: setCountry,
              stripe_customer_id: getSripeCustomerId,
              stripe_subscription_id: getStripeSubscriptionId,
              contact_id: getContactId,
              printed_invoice_id: getPdfId,
              printed_invoice_url: setPdfUrl,
            }
          };
          console.log('Invoice Body:');
          console.log(invoiceBody.properties);

          // 7 Create Invoice Custom Object Record
          const createInvoiceUrl = 'https://api.hubapi.com/crm/v3/objects/2-192773368';
          const tokenInv02 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_INV_02 = tokenInv02.access_token;
          let getInvoiceId;
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
            getInvoiceId = invoiceData.id;
            if (!invoiceRes.ok) {
              console.error('Invoice create failed:', invoiceRes.status, invoiceData);
            } else {
              console.log('Deal created');
            }
          } catch (err) {
            console.error('Fetch error creating deal:', err);
          }

          // 8 Create Note for Invoice Custom Object Record and associte to it Invoice PDF
          const noteUrl = 'https://api.hubapi.com/crm/v3/objects/notes';
          let createNoteBody = '<div style="" dir="auto" data-top-level="true"><p style="margin:0;"><strong><span style="color: #151E21;">INV-' + invoiceYear + '-' + setInvoiceSuffix + '</span></strong></p></div>';
          const noteBody = {
            properties: {
              hs_timestamp: Number(getPaymentDate * 1000),
              hs_note_body: createNoteBody,
              hubspot_owner_id: dealOwner,
              hs_attachment_ids: getPdfId
            },
            associations: [
              {
                to: {
                  id: getInvoiceId
                },
                types: [
                  {
                    associationCategory: "USER_DEFINED",
                    associationTypeId: 14
                  } 
                ]
              }
            ]
          };
          const tokenNote01 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_NOTE_01 = tokenNote01.access_token;
          const createNoteOptions = {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN_NOTE_01}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(noteBody)
          };
          
          try {
            const noteResponse = await fetch(noteUrl, createNoteOptions);
            const noteData = await noteResponse.json();
            if(noteData){
              console.log('Note is created and associated with Invoice PDF to Invoice Object');
            }
          } catch (error) {
            console.error(error);
          }

          //----- Associate Invoice Custom Object to Contact ---
          const invoiceToContactUrl = 'https://api.hubapi.com/crm/v4/objects/2-192773368/' + getInvoiceId + '/associations/contacts/' + getContactId;
          const tokenAssociation01 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_ASSOCIATION_01 = tokenAssociation01.access_token;
          const invoiceToContactOptions = {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN_ASSOCIATION_01}`, 
              'Content-Type': 'application/json'
            },
            body: JSON.stringify([
              { associationCategory: 'USER_DEFINED', associationTypeId:26 }
            ])
          };
          try {
            const invoiceToContactRes = await fetch(invoiceToContactUrl, invoiceToContactOptions);
            const invoiceToContactData = await invoiceToContactRes.json();
            if(invoiceToContactData){
              console.log('Invoice is associated to Contact');
            }
          } catch (error) {
            console.error(error);
          }

          //----- Associate Invoice Custom Object to Company ---
          if(getPayerType === 'company' && getCompanyId){
            const invoiceToCompanyUrl = 'https://api.hubapi.com/crm/v4/objects/2-192773368/' + getInvoiceId + '/associations/companies/' + getCompanyId;
            const tokenAssociation02 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_ASSOCIATION_02 = tokenAssociation02.access_token;
            const invoiceToCompanyOptions = {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_ASSOCIATION_02}`, 
                'Content-Type': 'application/json'
              },
              body: JSON.stringify([
                { associationCategory: 'USER_DEFINED', associationTypeId:30 }
              ])
            };
            try {
              const invoiceToCompanyRes = await fetch(invoiceToCompanyUrl, invoiceToCompanyOptions);
              const invoiceToCompanyData = await invoiceToCompanyRes.json();
              if(invoiceToCompanyData){
                console.log('Invoice is associated to Company');
              }
            } catch (error) {
              console.error(error);
            }
          }

          //----- Update Contact to get Membership and with PDF data to send Marketing Email
          const updateContactWithPdfUrl = 'https://api.hubapi.com/crm/v3/objects/contacts/' + getContactId;
          const updateContactWithPdfBody = {
            properties: {
              invoice_number: String('INV-' + invoiceYear + '-' + setInvoiceSuffix),
              invoice_pdf_url: setPdfUrl,
              invoice_pdf_id: getPdfId,
              has_subscriptions: 'Yes',
            },
          };
          const tokenUpdateContactWithPdf = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_UPDATE_CONTACT_WITH_PDF = tokenUpdateContactWithPdf.access_token;
          const updateContactWithPdfOptions = {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN_UPDATE_CONTACT_WITH_PDF}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateContactWithPdfBody)
          };

          try {
            const updateContactWithPdfRes = await fetch(updateContactWithPdfUrl, updateContactWithPdfOptions);
            const updateContactWithPdfData = await updateContactWithPdfRes.json();
            if(updateContactWithPdfData){
              console.log('Contact is ready to send Invoice Marketing Email');
            }
          } catch (error) {
            console.error(error);
          }

        } else if (invoice.billing_reason === 'subscription_cycle') {
          // Renewal succeeded
        }
        // Optionally push to HubSpot or your DB
        // amount = dollars(invoice.amount_paid, invoice.currency)
      }
  
      if (event.type === 'invoice.payment_failed') {
        if (invoice.billing_reason === 'subscription_cycle') {
          // Renewal failed -> mark past_due, email user
        } else if (invoice.billing_reason === 'subscription_create') {
            console.log('Subscription PAYMENT FAILED!')
          // First payment failed -> subscription likely stays 'incomplete'
        }
      }
  
      if (event.type === 'invoice.payment_action_required') {
        // Requires SCA action; prompt user on client if you’re in-session
      }
    },
  
    async onTrialWillEnd(event) {
      const sub = event.data.object;
      // Notify user that trial ends on sub.trial_end (unix timestamp)
    },
  };  