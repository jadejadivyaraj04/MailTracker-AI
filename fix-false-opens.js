#!/usr/bin/env node

// Script to clean up false opens in MailTracker AI database
// This will remove opens that are clearly from the sender viewing their own email

const mongoose = require('mongoose');
require('dotenv').config({ path: './server/.env' });

// Import models (simplified versions)
const messageSchema = new mongoose.Schema({
  uid: String,
  userId: String,
  senderEmail: String,
  recipients: Object,
  sentAt: Date
});

const openEventSchema = new mongoose.Schema({
  messageUid: String,
  recipientEmail: String,
  token: String,
  createdAt: Date
});

const Message = mongoose.model('Message', messageSchema);
const OpenEvent = mongoose.model('OpenEvent', openEventSchema);

async function fixFalseOpens() {
  console.log('🔧 MailTracker AI - False Opens Cleanup');
  console.log('=====================================');

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mailtracker');
    console.log('✅ Connected to MongoDB');

    // Find all messages with opens
    const messages = await Message.find({}).lean();
    console.log(`📧 Found ${messages.length} messages`);

    let totalOpensRemoved = 0;
    let messagesProcessed = 0;

    for (const message of messages) {
      const opens = await OpenEvent.find({ messageUid: message.uid });
      
      if (opens.length === 0) continue;

      messagesProcessed++;
      const senderEmail = message.senderEmail?.toLowerCase().trim();
      const sentAt = new Date(message.sentAt);
      
      console.log(`\n📧 Processing: "${message.subject}" (${opens.length} opens)`);
      console.log(`   Sender: ${senderEmail || 'NOT SET'}`);
      console.log(`   Sent: ${sentAt.toLocaleString()}`);

      let removedCount = 0;

      for (const open of opens) {
        const openTime = new Date(open.createdAt);
        const timeDiffSeconds = (openTime - sentAt) / 1000;
        const recipientEmail = open.recipientEmail?.toLowerCase().trim();
        
        let shouldRemove = false;
        let reason = '';

        // Remove if sender is viewing their own email
        if (senderEmail && recipientEmail === senderEmail) {
          shouldRemove = true;
          reason = 'sender viewing own email';
        }
        // Remove if opened too soon (likely sender preview)
        else if (timeDiffSeconds < 30) {
          shouldRemove = true;
          reason = `opened too soon (${timeDiffSeconds.toFixed(1)}s)`;
        }

        if (shouldRemove) {
          await OpenEvent.deleteOne({ _id: open._id });
          console.log(`   ❌ Removed: ${recipientEmail} - ${reason}`);
          removedCount++;
          totalOpensRemoved++;
        } else {
          console.log(`   ✅ Kept: ${recipientEmail} - ${timeDiffSeconds.toFixed(1)}s after send`);
        }
      }

      if (removedCount > 0) {
        console.log(`   🧹 Removed ${removedCount} false opens from this message`);
      }
    }

    console.log('\n🎉 Cleanup Complete!');
    console.log('===================');
    console.log(`📊 Messages processed: ${messagesProcessed}`);
    console.log(`🗑️  False opens removed: ${totalOpensRemoved}`);
    
    if (totalOpensRemoved > 0) {
      console.log('\n✅ Your dashboard should now show accurate read status!');
      console.log('   Refresh your dashboard to see the updated data.');
    } else {
      console.log('\n✅ No false opens found - your data is already clean!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nMake sure:');
    console.log('1. MongoDB is running');
    console.log('2. The MONGO_URI in server/.env is correct');
    console.log('3. You have the required dependencies: npm install mongoose dotenv');
  } finally {
    await mongoose.disconnect();
  }
}

fixFalseOpens();