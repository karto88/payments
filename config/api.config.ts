/**
 * API Configuration
 * ყველა endpoint ერთ ადგილას
 */

export const API_CONFIG = {
  // eCommerce Service
  ECOMMERCE: {
    BASE_URL: 'https://gateway.dev.keepz.me/ecommerce-service',
    ENDPOINTS: {
      CREATE_ORDER: '/api/integrator/order',
      REFUND: '/api/integrator/order/refund',
    },
  },

  // Payment Service
  PAYMENT: {
    BASE_URL: 'https://gateway.dev.keepz.me/payment-service',
    ENDPOINTS: {
      ENCRYPT: '/api/v1/test/encryptAES',
      DECRYPT: '/api/v1/test/decryptAES',
    },
  },

  // Admin Service
  ADMIN: {
    BASE_URL: 'https://newadmin.dev.keepz.me',
    ENDPOINTS: {
      TRANSACTION_FILTER: '/api/transaction/filter',
      TRANSACTION_UPDATE_STATUS: '/api/transaction/update-status',
    },
  },

  // Common Service (Auth)
  COMMON: {
    BASE_URL: 'https://gateway.dev.keepz.me/common-service',
    ENDPOINTS: {
      SEND_SMS: '/api/v1/auth/send-sms',
      VERIFY_SMS: '/api/v1/auth/verify-sms',
      LOGIN: '/api/v1/auth/login',
    },
  },
};
