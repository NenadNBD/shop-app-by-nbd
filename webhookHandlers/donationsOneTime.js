module.exports = {
    async onSucceeded(pi) {
      const meta = pi.metadata || {};
      // meta: productId, isCustom, priceId?, customer_email, etc.
      // Write order row, mark as paid
    },
    async onFailed(pi) {
      // Mark failed, store reason pi.last_payment_error?.message
    },
  };