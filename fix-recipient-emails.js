#!/usr/bin/env node

// Script to fix missing recipientEmail in OpenEvents
// This will help identify which opens belong to which recipients

const mongoose = require('mongoose');
require('dotenv').config({ path: './server/.env' });

// Import models (simplified versions)
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

async function fixRecipientEmails() {
  console.log('🔧 MailTracker AI - Fix Recipient Emails');
  console.log('=======================================');

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mailtracker');
    console.log('✅ Connected to MongoDB');

    // Find opens without recipient emails
    const opensWithoutEmail = await OpenEvent.find({ 
      $or: [
        { recipientEmail: null },
        { recipientEmail: '' },
        { recipientEmail: { $exists: false } }
      ]
    });

    console.log(`📧 Found ${opensWithoutEmail.length} opens without recipient emails`);

    if (opensWithoutEmail.length === 0) {
      console.log('✅ All opens already have recipient emails!');
      return;
    }

    let fixed = 0;

    for (const open of opensWithoutEmail) {
      console.log(`\n🔍 Processing open for message: ${open.messageUid}`);
      
      // Find the message
      const message = await Message.findOne({ uid: open.messageUid });
      if (!message) {
        console.log('   ❌ Message not found');
        continue;
      }

      let recipientEmail = null;

      // Try to identify recipient via token
      if (open.token && message.recipientTokens) {
        const tokens = message.recipientTokens instanceof Map ? 
          Object.fromEntries(message.recipientTokens) : 
          message.recipientTokens;

        const matchingEntry = Object.entries(tokens).find(([_, storedToken]) => 
          storedToken === open.token
        );

        if (matchingEntry) {
          recipientEmail = matchingEntry[0];
          console.log(`   ✅ Identified via token: ${recipientEmail}`);
        }
      }

      // Fallback: if single recipient, assume it's them
      if (!recipientEmail && message.recipients?.to?.length === 1) {
        recipientEmail = message.recipients.to[0];
        console.log(`   ✅ Single recipient fallback: ${recipientEmail}`);
      }

      // Update the open event
      if (recipientEmail) {
        await OpenEvent.updateOne(
          { _id: open._id },
          { recipientEmail: recipientEmail.toLowerCase().trim() }
        );
        fixed++;
        console.log(`   ✅ Updated open with recipient: ${recipientEmail}`);
      } else {
        console.log('   ❌ Could not identify recipient');
      }
    }

    console.log('\n🎉 Fix Complete!');
    console.log('================');
    console.log(`📊 Opens processed: ${opensWithoutEmail.length}`);
    console.log(`🔧 Opens fixed: ${fixed}`);
    
    if (fixed > 0) {
      console.log('\n✅ Recipient emails have been added to open events!');
      console.log('   Restart your server and check the dashboard again.');
    }

    // Now check for any remaining issues
    console.log('\n🔍 Checking for remaining issues...');
    
    const recentMessages = await Message.find({}).sort({ createdAt: -1 }).limit(5);
    
    for (const message of recentMessages) {
      const opens = await OpenEvent.find({ messageUid: message.uid });
      
      console.log(`\n📧 "${message.subject}" (${message.uid})`);
      console.log(`   Sender: ${message.senderEmail || 'NOT SET'}`);
      console.log(`   Recipients: ${JSON.stringify(message.recipients?.to || [])}`);
      console.log(`   Opens: ${opens.length}`);
      
      opens.forEach((open, i) => {
        const timeDiff = message.sentAt ? 
          (new Date(open.createdAt) - new Date(message.sentAt)) / 1000 : 0;
        
        console.log(`     ${i + 1}. ${open.recipientEmail || 'NO EMAIL'} (${timeDiff.toFixed(1)}s)`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

fixRecipientEmails();