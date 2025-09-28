const { retryFor } = require('../utils/retry');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const setHubSpotToken = require('../database/getTokens');

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
      properties: ['hs_object_id']
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
      let getProductName;
      let getAmount;
      let getContactId;
      let getCompanyId;
      const piCharge = await stripe.paymentIntents.retrieve(pi.id, {
        expand: ['latest_charge', 'payment_method']
      });
      const meta = pi.metadata || {};
      getPortalId = String(meta.hsPortalId || '').trim();
      getPayerType = String(meta.payerType || '').trim().toLowerCase();
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
        if(getCountry === 'US'){
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
        const company = await searchCompanyByNameOrDomain(ACCESS_TOKEN02, { name: companyNameToSearch, domain });
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
    },
    async onFailed(pi) {
      // Mark failed
    },
  };