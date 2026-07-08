import * as imaps from 'imap-simple';
import { simpleParser } from 'mailparser';

export class GmailHelper {
  private config: any;

  constructor(email: string, appPassword: string) {
    this.config = {
      imap: {
        user: email,
        password: appPassword.replace(/\s+/g, ''),
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      },
    };
  }

  async getLatestOTP(timeoutSeconds = 20, fromEmail?: string, bank?: 'BOG' | 'TBC' | 'CREDO'): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutSeconds * 1000) {
      try {
        const connection = await imaps.connect(this.config);
        await connection.openBox('INBOX');

        const oneMinuteAgo = new Date(Date.now() - 60000);
        const searchCriteria = [['SINCE', oneMinuteAgo]];
        const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], markSeen: true };

        const messages = await connection.search(searchCriteria, fetchOptions);

        if (messages.length > 0) {
          const latestMessage = messages[messages.length - 1];
          const all = latestMessage.parts.find((part: any) => part.which === '');

          if (all) {
            const parsed = await simpleParser(all.body);
            const emailBody = parsed.text || parsed.html || '';
            const emailSubject = parsed.subject || '';
            const emailDate = parsed.date;
            const emailFrom = parsed.from?.text || '';

            // თუ fromEmail მითითებულია, შევამოწმოთ გამომგზავნი
            if (fromEmail && !emailFrom.toLowerCase().includes(fromEmail.toLowerCase())) {
              await connection.end();
              await new Promise((resolve) => setTimeout(resolve, 2000));
              continue;
            }

            const emailAge = Date.now() - (emailDate ? emailDate.getTime() : 0);

            if (emailAge < 30000) {
              // თუ bank მითითებულია, შევამოწმოთ Subject-ში
              if (bank) {
                const bankInSubject = bank === 'CREDO'
                  ? emailSubject.toLowerCase().includes('credo')
                  : emailSubject.includes(`${bank} OTP`);

                if (!bankInSubject) {
                  await connection.end();
                  await new Promise((resolve) => setTimeout(resolve, 2000));
                  continue;
                }
              }

              // BOG/TBC OTP - 58986
              let otpMatch = emailSubject.match(/(?:BOG|TBC) OTP\s*-\s*(\d{4,6})/i);

              // CREDO OTP (Subject-ში ან body-ში)
              if (!otpMatch && bank === 'CREDO') {
                otpMatch = emailSubject.match(/(\d{4,6})/);
                if (!otpMatch) otpMatch = emailBody.match(/\b(\d{4,6})\b/);
              }

              // Fallback: ნებისმიერი 4-6 ციფრი
              if (!otpMatch) otpMatch = emailBody.match(/\b(\d{4,6})\b/);

              if (otpMatch) {
                await connection.end();
                return otpMatch[1];
              }
            }
          }
        }

        await connection.end();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error: any) {
        if (error.message.includes('Invalid credentials')) {
          throw new Error('Gmail auth failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    throw new Error('OTP not found');
  }

  async deleteOldOTPEmails(): Promise<number> {
    try {
      const connection = await imaps.connect(this.config);
      await connection.openBox('INBOX');

      const searchCriteria = [
        ['OR',
          ['SUBJECT', 'BOG OTP'],
          ['OR',
            ['SUBJECT', 'TBC OTP'],
            ['SUBJECT', 'CREDO']
          ]
        ]
      ];
      const fetchOptions = { bodies: ['HEADER'], markSeen: false };

      const messages = await connection.search(searchCriteria, fetchOptions);

      if (messages.length > 0) {
        const uids = messages.map((msg: any) => msg.attributes.uid);
        await connection.addFlags(uids, '\\Deleted');
        await connection.imap.expunge();
        await connection.end();
        return messages.length;
      }

      await connection.end();
      return 0;
    } catch (error) {
      console.error('Failed to delete emails:', error);
      return 0;
    }
  }
}
