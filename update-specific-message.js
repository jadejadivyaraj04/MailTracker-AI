#!/usr/bin/env node

// Quick script to test the new validation on your specific message

const BASE_URL = 'http://localhost:5000';

async function testSpecificMessage() {
  const messageUid = '4e6462cf-b81d-471d-8cee-47e8dfe1a9e4';
  
  console.log('🔍 Testing Your Specific Message');
  console.log('================================');
  console.log(`Message UID: ${messageUid}\n`);

  try {
    // Get debug info for your message
    const response = await fetch(`${BASE_URL}/debug/track/${messageUid}`);
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('📧 Message Details:');
    console.log(`   Subject: "${data.message?.subject}"`);
    console.log(`   Sender: ${data.message?.senderEmail}`);
    console.log(`   Recipients: ${JSON.stringify(data.message?.recipients)}`);
    console.log(`   Sent: ${new Date(data.message?.sentAt).toLocaleString()}\n`);
    
    console.log('📊 Opens Analysis:');
    console.log(`   Total Opens: ${data.opens.length}`);
    console.log(`   Valid Opens: ${data.validated?.openCount || 0}`);
    console.log(`   Status: ${data.validated?.openCount > 0 ? '📖 READ' : '📪 UNREAD'}\n`);
    
    if (data.opens.length > 0) {
      console.log('📋 Open Details:');
      data.opens.forEach((open, i) => {
        const timeSinceSent = open.timeSinceSent || 0;
        console.log(`   ${i + 1}. Email: ${open.recipientEmail || 'UNKNOWN'}`);
        console.log(`      Time: ${timeSinceSent.toFixed(1)}s after send`);
        console.log(`      Is Proxy: ${open.isProxy ? '✅ YES' : '❌ NO'}`);
        console.log(`      User Agent: ${open.userAgent?.substring(0, 50)}...`);
      });
    }
    
    console.log('\n🎯 Expected Result:');
    console.log('   With new logic, this should show as READ because:');
    console.log('   - First open (0.3s) filtered out (no recipient email)');
    console.log('   - Second open (77s) accepted (proxy but only open for recipient)');
    console.log('   - Final status: READ ✅');
    
    // Test user stats
    console.log('\n📊 Checking User Stats...');
    const userEmail = 'divyarajsinh.jadeja@bytestechnolab.com';
    const statsResponse = await fetch(`${BASE_URL}/stats/user/${encodeURIComponent(userEmail)}`);
    
    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      const thisMessage = stats.messages.find(m => m.uid === messageUid);
      
      if (thisMessage) {
        console.log(`   Dashboard Status: ${thisMessage.openCount > 0 ? '📖 READ' : '📪 UNREAD'}`);
        console.log(`   Open Count: ${thisMessage.openCount}`);
        console.log(`   Recipients: ${JSON.stringify(thisMessage.recipients)}`);
        
        if (thisMessage.recipientStatus) {
          console.log('   Per-Recipient Status:');
          thisMessage.recipientStatus.forEach(status => {
            console.log(`     - ${status.email}: ${status.read ? 'READ' : 'UNREAD'}`);
          });
        }
      } else {
        console.log('   ❌ Message not found in user stats');
      }
    } else {
      console.log('   ❌ Could not fetch user stats');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nMake sure:');
    console.log('1. Backend server is running: cd server && npm run dev');
    console.log('2. Server has the new validation logic');
  }
}

testSpecificMessage();