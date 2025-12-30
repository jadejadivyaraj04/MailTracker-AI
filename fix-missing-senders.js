#!/usr/bin/env node

// Script to fix messages with missing sender emails

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

const Message = mongoose.model('Message', messageSchema);

async function fixMissingSenders() {
  console.log('🔧 MailTracker AI - Fix Missing Sender Emails');
  console.log('============================================');

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mailtracker');
    console.log('✅ Connected to MongoDB');

    // Find messages with null or missing sender emails
    const messagesWithoutSender = await Message.find({
      $or: [
        { senderEmail: null },
        { senderEmail: '' },
        { senderEmail: { $exists: false } }
      ]
    }).sort({ createdAt: -1 });

    console.log(`📧 Found ${messagesWithoutSender.length} messages without sender emails`);

    if (messagesWithoutSender.length === 0) {
      console.log('✅ All messages already have sender emails!');
      return;
    }

    let fixed = 0;

    for (const message of messagesWithoutSender) {
      console.log(`\n🔍 Processing message: "${message.subject}" (${message.uid})`);
      console.log(`   User ID: ${message.userId}`);
      console.log(`   Current sender: ${message.senderEmail || 'NULL'}`);

      let newSenderEmail = null;

      // Strategy 1: Use userId if it looks like an email
      if (message.userId && message.userId !== 'default' && message.userId.includes('@')) {
        newSenderEmail = message.userId.toLowerCase().trim();
        console.log(`   ✅ Using userId as sender: ${newSenderEmail}`);
      }
      // Strategy 2: Check if sender is in BCC (common pattern)
      else if (message.recipients?.bcc?.length > 0) {
        const bccEmails = message.recipients.bcc.filter(email => 
          email && email.includes('@') && email !== 'default'
        );
        if (bccEmails.length === 1) {
          newSenderEmail = bccEmails[0].toLowerCase().trim();
          console.log(`   ✅ Using BCC email as sender: ${newSenderEmail}`);
        }
      }
      // Strategy 3: Check recipient tokens for sender pattern
      else if (message.recipientTokens) {
        const tokenEmails = Object.keys(message.recipientTokens);
        const senderCandidates = tokenEmails.filter(email => 
          email && email.includes('@') && email !== 'default'
        );
        
        // If there's a common domain pattern, use the first one
        if (senderCandidates.length > 0) {
          newSenderEmail = senderCandidates[0].toLowerCase().trim();
          console.log(`   ⚠️  Guessing sender from tokens: ${newSenderEmail}`);
        }
      }

      // Update the message if we found a sender
      if (newSenderEmail) {
        await Message.updateOne(
          { _id: message._id },
          { senderEmail: newSenderEmail }
        );
        fixed++;
        console.log(`   ✅ Updated sender email: ${newSenderEmail}`);
      } else {
        console.log('   ❌ Could not determine sender email');
      }
    }

    console.log('\n🎉 Fix Complete!');
    console.log('================');
    console.log(`📊 Messages processed: ${messagesWithoutSender.length}`);
    console.log(`🔧 Sender emails fixed: ${fixed}`);
    
    if (fixed > 0) {
      console.log('\n✅ Sender emails have been added to messages!');
      console.log('   This should improve tracking accuracy.');
    }

    // Show summary of recent messages
    console.log('\n📊 Recent Messages Summary:');
    const recentMessages = await Message.find({}).sort({ createdAt: -1 }).limit(10);
    
    recentMessages.forEach((msg, i) => {
      console.log(`${i + 1}. "${msg.subject}" - Sender: ${msg.senderEmail || 'NULL'} - User: ${msg.userId}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

fixMissingSenders();