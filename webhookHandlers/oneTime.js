module.exports = {
    async onSucceeded(pi) {
      console.log('Payment Intent Succeeded');
      console.log(pi);
      const meta = pi.metadata || {};
      // Record non-donation purchase
    },
    async onFailed(pi) {
      // Mark failed
    },
  };