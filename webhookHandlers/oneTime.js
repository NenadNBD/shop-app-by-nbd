module.exports = {
    async onSucceeded(pi) {
      const meta = pi.metadata || {};
      // Record non-donation purchase
    },
    async onFailed(pi) {
      // Mark failed
    },
  };