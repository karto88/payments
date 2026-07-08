import { test } from '@playwright/test';
import { TreasuryOrderHelper } from '../../utils/order-helpers';

test('Treasury Order', async ({ request }) => {
  const helper = new TreasuryOrderHelper(request);

  await helper.createAndPayOrder({
    amount: 0.1,
    receiverId: 'c6c6413d-cb99-49bc-a85e-267af8f96eb9',
    integratorId: '5c1633f6-fb36-44b0-9560-db6c308dfe01',
    receiverType: 'BRANCH',
    cardType: 'TBC',
    
    orderProperties: {
      PURPOSE: {
        value: 'პირადი',
        isEditable: true
      },
      PAYER_NAME: {
        value: 'დავით კარტოზია',
        isEditable: true
      },
      PERSONAL_NUMBER: {
        value: '48001015578',
        isEditable: true
      },
      IS_FOREIGN: {
        value: 'false',
        isEditable: false
      }
    }
  });
  
});