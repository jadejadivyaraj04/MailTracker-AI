#!/usr/bin/env node

// Debug script to investigate false "READ" status in MailTracker AI
// Run with: node debug-false-opens.js <your-email>

const BASE_URL = 'http://localhost:5000';

async function debugFalseOpens(userEmail) {
  if (!userEmail) {
    console.log('Usage: node debug-false-opens.js <your-email>');
    console.log('Example: node debug-false-opens.js john@example.com');
    process.exit(1);
  }

  console.log('🔍 Debugging False Opens for MailTracker AI');
  console.log('===========================================');
  console.log(`User Email: ${userEmail}\n`);

  try {
    // Get user stats
    console.log('📊 Fetching user stats...');
    const statsResponse = await fetch(`${BASE_URL}/stats/user/${encodeURIComponent(userEmail)}`);
    
    if (!statsResponse.ok) {
      throw new Error(`Stats API returned ${statsResponse.status}`);
    }
    
    const stats = await statsResponse.json();
    console.log(`Found ${stats.totalMessages} messages with ${stats.totalOpens} total opens\n`);

    if (stats.messages.length === 0) {
      console.log('❌ No messages found. Send a test email first.');
      return;
    }

    // Analyze each message
    for (const message of stats.messages.slice(0, 5)) { // Check last 5 messages
      console.log(`📧 Message: "${message.subject}" (${message.uid})`);
      console.log(`   Sent: ${new Date(message.sentAt).toLocaleString()}`);
      console.log(`   Recipients: ${JSON.stringify(message.recipients)}`);
      console.log(`   Dashboard shows: ${message.openCount} opens, Status: ${message.openCount > 0 ? '📖 READ' : '📪 UNREAD'}`);

      // Get detailed debug info
      const debugResponse = await fetch(`${BASE_URL}/debug/track/${message.uid}`);
      if (debugResponse.ok) {
        const debug = await debugResponse.json();
        
        console.log(`   Sender Email: ${debug.message?.senderEmail || 'NOT SET'}`);
        console.log(`   Raw Opens: ${debug.opens.length}`);
        console.log(`   Valid Opens: ${debug.validated?.openCount || 0}`);
        
        if (debug.opens.length > 0) {
          console.log('   📋 Open Details:');
          debug.opens.forEach((open, i) => {
            const timeSinceSent = open.timeSinceSent || 0;
            const isSender = debug.message?.senderEmail && 
                           open.recipientEmail === debug.message.senderEmail;
            
            console.log(`     ${i + 1}. Email: ${open.recipientEmail || 'UNKNOWN'}`);
            console.log(`        Time: ${timeSinceSent.toFixed(1)}s after send`);
            console.log(`        Is Sender: ${isSender ? '✅ YES (should be filtered)' : '❌ NO'}`);
            console.log(`        Is Proxy: ${open.isProxy ? '✅ YES' : '❌ NO'}`);
            console.log(`        Token: ${open.token || 'NONE'}`);
          });
        }
        
        if (debug.opens.length > 0 && debug.validated?.openCount === 0) {
          console.log('   ✅ GOOD: All opens were filtered out (no false positives)');
        } else if (debug.opens.length > 0 && debug.validated?.openCount > 0) {
          console.log('   ⚠️  WARNING: Some opens were not filtered - check if recipient actually opened');
        }
      }
      console.log('');
    }

    // Get detailed opens analysis
    console.log('🔬 Detailed Opens Analysis...');
    const opensResponse = await fetch(`${BASE_URL}/debug/user/${encodeURIComponent(userEmail)}/opens`);
    if (opensResponse.ok) {
      const opensData = await opensResponse.json();
      
      console.log('\n📈 Summary by Message:');
      opensData.analysis.forEach(msg => {
        const hasIssue = msg.totalOpens > msg.validOpens;
        console.log(`${hasIssue ? '⚠️ ' : '✅ '} "${msg.subject}"`);
        console.log(`   Total/Valid Opens: ${msg.totalOpens}/${msg.validOpens}`);
        console.log(`   Sender: ${msg.senderEmail || 'NOT SET'}`);
        
        if (hasIssue) {
          console.log('   🔍 Filtered Opens:');
          msg.opens.forEach(open => {
            if (msg.senderEmail && open.recipientEmail === msg.senderEmail) {
              console.log(`     - Sender open: ${open.recipientEmail} (${open.timeSinceSent.toFixed(1)}s)`);
            } else if (open.timeSinceSent < 30) {
              console.log(`     - Too soon: ${open.recipientEmail} (${open.timeSinceSent.toFixed(1)}s)`);
            } else if (open.isProxy) {
              console.log(`     - Email proxy: ${open.recipientEmail}`);
            }
          });
        }
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Make sure the backend server is running: cd server && npm run dev');
    console.log('2. Check that you used the correct email address');
    console.log('3. Send a test email first if no messages found');
  }
}

// Get email from command line argument
const userEmail = process.argv[2];
debugFalseOpens(userEmail);