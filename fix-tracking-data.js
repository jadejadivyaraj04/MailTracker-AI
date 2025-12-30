#!/usr/bin/env node

// Comprehensive script to fix tracking data issues

const mongoose = require('mongoose');
require('dotenv').config({ path: './server/.env' });

// Import models
const messageSchema = new mongoose.Schema({
  uid: String,
  userId: String,
  senderEmail: String,
  recipients: Object,
  recipientTokens: Object,
  sentAt: Date
});

const openEventSchema = new mongoose.Schema({
  messageUid: String,
  recipientEmail: String,
  token: String,
  createdAt: Date,
  isProxy: Boolean
});

const Message = mongoose.model('Message', messageSchema);
const OpenEvent = mongoose.model('OpenEvent', openEventSchema);

async function fixTrackingData() {
  console.log('🔧 MailTracker AI - Comprehensive Data Fix');
  console.log('==========================================');

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mailtracker');
    console.log('✅ Connected to MongoDB');

    // Step 1: Fix missing sender emails
    console.log('\n📧 Step 1: Fixing missing sender emails...');
    const messagesWithoutSender = await Message.find({
      $or: [
        { senderEmail: null },
        { senderEmail: '' },
        { senderEmail: { $exists: false } }
      ]
    });

    let sendersFixed = 0;
    for (const message of messagesWithoutSender) {
      let newSenderEmail = null;

      if (message.userId && message.userId !== 'default' && message.userId.includes('@')) {
        newSenderEmail = message.userId.toLowerCase().trim();
      } else if (message.recipients?.bcc?.length === 1 && message.recipients.bcc[0].includes('@')) {
        newSenderEmail = message.recipients.bcc[0].toLowerCase().trim();
      }

      if (newSenderEmail) {
        await Message.updateOne({ _id: message._id }, { senderEmail: newSenderEmail });
        sendersFixed++;
      }
    }
    console.log(`   ✅ Fixed ${sendersFixed} sender emails`);

    // Step 2: Fix missing recipient emails in opens
    console.log('\n📧 Step 2: Fixing missing recipient emails in opens...');
    const opensWithoutEmail = await OpenEvent.find({
      $or: [
        { recipientEmail: null },
        { recipientEmail: '' },
        { recipientEmail: { $exists: false } }
      ]
    });

    let recipientsFixed = 0;
    for (const open of opensWithoutEmail) {
      const message = await Message.findOne({ uid: open.messageUid });
      if (!message) continue;

      let recipientEmail = null;

      // Try token-based identification
      if (open.token && message.recipientTokens) {
        const tokens = message.recipientTokens instanceof Map ? 
          Object.fromEntries(message.recipientTokens) : 
          message.recipientTokens;

        const matchingEntry = Object.entries(tokens).find(([_, storedToken]) => 
          storedToken === open.token
        );

        if (matchingEntry) {
          recipientEmail = matchingEntry[0];
        }
      }

      // Fallback: single recipient
      if (!recipientEmail) {
        const allRecipients = [
          ...(message.recipients?.to || []),
          ...(message.recipients?.cc || []),
          ...(message.recipients?.bcc || [])
        ].filter(Boolean);

        if (allRecipients.length === 1) {
          recipientEmail = allRecipients[0];
        }
      }

      if (recipientEmail) {
        await OpenEvent.updateOne(
          { _id: open._id },
          { recipientEmail: recipientEmail.toLowerCase().trim() }
        );
        recipientsFixed++;
      }
    }
    console.log(`   ✅ Fixed ${recipientsFixed} recipient emails in opens`);

    // Step 3: Analysis and summary
    console.log('\n📊 Step 3: Data analysis...');
    
    const totalMessages = await Message.countDocuments();
    const messagesWithSender = await Message.countDocuments({ 
      senderEmail: { $exists: true, $ne: null, $ne: '' }
    });
    const totalOpens = await OpenEvent.countDocuments();
    const opensWithRecipient = await OpenEvent.countDocuments({
      recipientEmail: { $exists: true, $ne: null, $ne: '' }
    });

    console.log(`   📧 Messages: ${messagesWithSender}/${totalMessages} have sender emails`);
    console.log(`   📖 Opens: ${opensWithRecipient}/${totalOpens} have recipient emails`);

    // Step 4: Test validation on recent messages
    console.log('\n🧪 Step 4: Testing validation on recent messages...');
    
    const recentMessages = await Message.find({}).sort({ createdAt: -1 }).limit(5);
    
    for (const message of recentMessages) {
      const opens = await OpenEvent.find({ messageUid: message.uid });
      
      console.log(`\n📧 "${message.subject}"`);
      console.log(`   Sender: ${message.senderEmail || 'NULL'}`);
      console.log(`   Recipients: ${JSON.stringify(message.recipients?.to || [])}`);
      console.log(`   Opens: ${opens.length} total`);
      
      let validOpens = 0;
      opens.forEach(open => {
        const hasRecipient = open.recipientEmail && open.recipientEmail.trim();
        const isSender = message.senderEmail && 
                        open.recipientEmail === message.senderEmail;
        const timeDiff = message.sentAt ? 
          (new Date(open.createdAt) - new Date(message.sentAt)) / 1000 : 0;
        
        if (hasRecipient && !isSender && timeDiff > 10) {
          validOpens++;
        }
      });
      
      console.log(`   Valid opens: ${validOpens}`);
      console.log(`   Status: ${validOpens > 0 ? '📖 READ' : '📪 UNREAD'}`);
    }

    console.log('\n🎉 Comprehensive Fix Complete!');
    console.log('==============================');
    console.log(`🔧 Sender emails fixed: ${sendersFixed}`);
    console.log(`🔧 Recipient emails fixed: ${recipientsFixed}`);
    console.log('\n✅ Your tracking should now be much more accurate!');
    console.log('   Restart your server and check the dashboard.');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

fixTrackingData();