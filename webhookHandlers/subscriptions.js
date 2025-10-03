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
  
  module.exports = {
    // Lifecycle updates: trialing -> active -> past_due -> canceled …
    async onSubscriptionEvent(event) {
        let getContactId;
        let getEmail;
        let getFullName;
        let getAddress;
        let getCity;
        let getZip;
        let getState;
        let getCountry;
        let getCompanyName;
        let getCompanyId;
        let getPortalId;
        let getPayerType;
        let getProductName;
        let getSripeCustomerId;
        let getStripeSubscriptionId;
        let getStripeSubscriptionStatus;
        let getCurrentPeriodEnd;
      const sub = event.data.object;
      // sub.status: trialing | active | past_due | canceled | incomplete | incomplete_expired | unpaid | paused
      // sub.metadata.flow: 'trial' | 'pay_now' (if you set this on create)
      console.log('Monitor Subscription Creation');
      switch (event.type) {
        case 'customer.subscription.created':
          getEmail = String(sub.metadata.email || '').trim();
          getFullName = String(sub.metadata.full_name || '').trim();
          getPortalId = String(sub.metadata.hsPortalId || '').trim();
          getPayerType = String(sub.metadata.payer_type || '').trim();
          getCompanyName = String(sub.metadata.company || '').trim();
          getProductName = String(sub.metadata.product_name || '').trim();
          getSripeCustomerId = String(sub.customer || '').trim();
          getStripeSubscriptionId = String(sub.id || '').trim();
          getStripeSubscriptionStatus = String(sub.status || '').trim();
          getCurrentPeriodEnd = sub.current_period_end * 1000
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
          // Search for Company if Payer Type is COMPANY
          if(getPayerType === 'company' && getCompanyName){
            const companyNameToSearch = getCompanyName.toLowerCase();
            const emailForCompany = getEmail;
            const domain = (emailForCompany.includes('@') ? emailForCompany.split('@')[1] : '').toLowerCase();
            const tokenInfo02 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN02 = tokenInfo02.access_token;
            const company = await searchCompanyByNameOrDomain(ACCESS_TOKEN02, { name: companyNameToSearch, domain: domain });
            if (company) {
              getCompanyId = company.hs_object_id;
              console.log('Company found:', company.name);
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
          /*
          const createDealUrl = 'https://api.hubapi.com/crm/v3/objects/0-3';
          let setDealStage;
          if (sub.status === 'trialing') {
            setDealStage = '3311151350';
          }else if(sub.status === 'active'){
            setDealStage = '3311151352';
          }
          let setDealName;
          if(getPayerType === 'company'){
            setDealName = getCompanyName + ' - ' + getProductName;
          }else if(getPayerType === 'individual'){
            setDealName = getFullName + ' - ' + getProductName;
          }
          const dealCloseDate = Date.now();
          const dealOwner = '44516880';
          const dealAmount = Number(((sub.items?.data?.[0]?.price?.unit_amount ?? sub.items?.data?.[0]?.plan?.amount ?? 0) / 100).toFixed(2));
          const dealBody = {
            properties: {
              amount: dealAmount,
              closedate: dealCloseDate,
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
          const hubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows';
          const publishHubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/draft/publish';
          */
      
          // ----- TRIAL ---

          /*
          if (sub.status === 'trialing') {
            const tokenInfoDeal1 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_DEAL1 = tokenInfoDeal1.access_token;
            const createTrialDealOptions = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_DEAL1}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(dealBody)
            };
            try {
              const trialDealRes = await fetch(createDealUrl, createTrialDealOptions);
              const trialDealData = await trialDealRes.json();
              if (!trialDealRes.ok) {
                console.error('Deal create failed:', trialDealRes.status, trialDealData);
              } else {
                console.log('Trial Deal created');
              }
            } catch (err) {
              console.error('Fetch error creating deal:', err);
            }
            const tokenInfoTr1 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_TR1 = tokenInfoTr1.access_token;
            const hubDbOptions = {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ACCESS_TOKEN_TR1}`, 
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
            if(hubDbData){
                console.log(hubDbData);
                const tokenInfoTr2 = await setHubSpotToken(getPortalId);
                const ACCESS_TOKEN_TR2 = tokenInfoTr2.access_token;
                const publishHubDboptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_TR2}`}};
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

            */
          // ----- ACTIVE ---
/*
          } else if (sub.status === 'active') {
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
                console.log('Deal created');
              }
            } catch (err) {
              console.error('Fetch error creating deal:', err);
            }

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
            if(hubDbData){
                console.log(hubDbData);
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
          } else if (sub.status === 'incomplete') {
            console.log('SUBSCRIPTION IS INCOMPLETE. WILL BE PAYED?');
          }
          */
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
  
      if (event.type === 'invoice.payment_succeeded') {
        if (invoice.billing_reason === 'subscription_create') {
          // First charge for a non-trial sub (pay-first flow)
          // Or $0 invoice for trial start (rare; usually no invoice is generated at trial start)
          // Mark subscription as active/paid in your system
          console.log('Subscription is PAYED!');

          // ----- Create Invoice PDF and Invoice Custom Object for ACTIVE SUBSCRIPTION -----
          // 1 Search previous Invoices to get Invoice Sufix
          let getPortalId = String(invoice.metadata.hsPortalId || '').trim();
          const tokenInv01 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN_INV_01 = tokenInv01.access_token;
          const invoiceYear = new Date().getFullYear();
          const startSuffix = 1000;
          const lastInvoiceSuffix = await searchInvoicesByYear(ACCESS_TOKEN_INV_01, invoiceYear);
          console.log(lastInvoiceSuffix);
          const setInvoiceSuffix = lastInvoiceSuffix != null ? lastInvoiceSuffix + 1 : startSuffix;

          // 2 Create Invoice Body
          // 2-1 Get Subscription Detals
          const getSubscriptionId = String(invoice.subscription || '');
          const invSubscription = await stripe.subscriptions.retrieve(getSubscriptionId);
          let getInvPayerType = String(invSubscription.metadata.payer_type || '').trim();
          let getInvEmail = String(invSubscription.metadata.email || '').trim();
          let getInvFullName = String(invSubscription.metadata.full_name || '').trim();
          let getInvCompanyName = String(invSubscription.metadata.company || '').trim();
          let getInvProductName = String(invSubscription.metadata.product_name || '').trim();
          // 2-2 Get Payment Intent ID
          const invExpanded = await stripe.invoices.retrieve(invoice.id, {
            expand: ['payment_intent', 'payment_intent.latest_charge'],
          });
          const paymentIntentId = typeof invExpanded.payment_intent === 'string' ? invExpanded.payment_intent : invExpanded.payment_intent?.id || null;
          console.log('PI Id:', paymentIntentId);
          const latestChargeId = invExpanded.payment_intent?.latest_charge || null;
          let getPaymentMethodType = latestChargeId.payment_method_details.type;
          console.log('Payment Method:', getPaymentMethodType);
          // 2-3 Get Cusomer Datails
          const getCustomerId =  String(invoice.customer || '');
          const invCustomer = await stripe.customers.retrieve(getCustomerId);
          let getInvAddress = String(invCustomer.address.line1 || '').trim();
          let getInvCity = String(invCustomer.address.city || '').trim();
          let getInvZip = String(invCustomer.address.postal_code || '').trim();
          let getInvCountry = String(invCustomer.address.country || '').trim();
          let getInvState = String(invCustomer.address.state || '').trim();
          let setInvCountry = countryName(getInvCountry);
          let setInvState = getInvCountry.toUpperCase() === 'US' ? usStateName(getInvState) : getInvState || '';
          // 2-4 Get Invoice Detals
          let getPaymentDate = invoice.created;
          let getAmount = Number((invoice.amount_paid / 100).toFixed(2));
          let setBillToName;
          if(getInvPayerType === 'company'){
            setBillToName = getInvCompanyName;
          }else if(getInvPayerType === 'individual'){
            setBillToName = getInvFullName;
          }
          const paymentMethodLabels = {
            card: 'Card',
            google_pay: 'GooglePay',   // as you prefer (no space)
            apple_pay: 'Apple Pay',
            us_bank_account: 'US Bank Account'
          };
          let activeCurrentPeriodStart = stripeSecondsToHubSpotDatePicker(invoice.period_start);
          let activeCurrentPeriodEnd = stripeSecondsToHubSpotDatePicker(invoice.period_end);
          let stringActiveBillingCycle = `${formatInvoiceDate(activeCurrentPeriodStart) ?? ''} - ${formatInvoiceDate(activeCurrentPeriodEnd) ?? ''}`
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
              email: getInvEmail,
              address_line1: getInvAddress,
              city: getInvCity,
              state: setInvState,
              postal_code: getInvZip,
              country: setInvCountry
            },
            line_items: [
              { name: getInvProductName, quantity: 1, unit_price: getAmount, type: 'subscription', billing_cycle: stringActiveBillingCycle },
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
          
          // 5 INSERT PDF INTO FILES
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