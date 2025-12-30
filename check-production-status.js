#!/usr/bin/env node

// Script to check if the fixes are working in production

const PRODUCTION_URL = 'https://mailtracker-ai-1.onrender.com';
const USER_EMAIL = 'divyarajsinh.jadeja@bytestechnolab.com';

async function checkProductionStatus() {
  console.log('🌐 Checking Production MailTracker AI Status');
  console.log('===========================================');
  console.log(`Production URL: ${PRODUCTION_URL}`);
  console.log(`User Email: ${USER_EMAIL}\n`);

  try {
    // Test 1: Health check
    console.log('🏥 Health Check...');
    const healthResponse = await fetch(`${PRODUCTION_URL}/health`);
    
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log('✅ Production server is running');
      console.log(`   Uptime: ${Math.floor(health.uptime / 60)} minutes\n`);
    } else {
      console.log('❌ Production server health check failed\n');
    }

    // Test 2: Get user stats
    console.log('📊 Fetching User Stats...');
    const statsResponse = await fetch(`${PRODUCTION_URL}/stats/user/${encodeURIComponent(USER_EMAIL)}`);
    
    if (!statsResponse.ok) {
      throw new Error(`Stats API returned ${statsResponse.status}`);
    }
    
    const stats = await statsResponse.json();
    console.log(`✅ Found ${stats.totalMessages} messages with ${stats.totalOpens} total opens`);
    
    if (stats.messages.length === 0) {
      console.log('❌ No messages found in production');
      return;
    }

    // Test 3: Check recent messages for validation
    console.log('\n📧 Recent Messages Analysis:');
    
    const recentMessages = stats.messages.slice(0, 5);
    
    for (const message of recentMessages) {
      console.log(`\n📧 "${message.subject}" (${new Date(message.sentAt).toLocaleDateString()})`);
      console.log(`   Opens: ${message.openCount}`);
      console.log(`   Status: ${message.openCount > 0 ? '📖 READ' : '📪 UNREAD'}`);
      
      // Get detailed debug info for this message
      try {
        const debugResponse = await fetch(`${PRODUCTION_URL}/debug/track/${message.uid}`);
        if (debugResponse.ok) {
          const debug = await debugResponse.json();
          
          console.log(`   Sender: ${debug.message?.senderEmail || 'NULL'}`);
          console.log(`   Raw Opens: ${debug.opens?.length || 0}`);
          console.log(`   Valid Opens: ${debug.validated?.openCount || 0}`);
          
          if (debug.opens && debug.opens.length > 0) {
            debug.opens.forEach((open, i) => {
              const timeDiff = open.timeSinceSent || 0;
              console.log(`     ${i + 1}. ${open.recipientEmail || 'UNKNOWN'} (${timeDiff.toFixed(1)}s)`);
            });
          }
        }
      } catch (debugError) {
        console.log(`   ⚠️  Could not get debug info: ${debugError.message}`);
      }
    }

    // Test 4: Check if the problematic "Keka Open" email is fixed
    console.log('\n🔍 Looking for "Keka Open" email...');
    const kekaEmail = stats.messages.find(m => m.subject === 'Keka Open');
    
    if (kekaEmail) {
      console.log('📧 Found "Keka Open" email:');
      console.log(`   Opens: ${kekaEmail.openCount}`);
      console.log(`   Status: ${kekaEmail.openCount > 0 ? '📖 read' : '📪 UNREAD'}`);
      
      if (kekaEmail.openCount === 0) {
        console.log('   ✅ GOOD: False positive has been filtered out!');
      } else {
        console.log('   ❌ ISSUE: Still showing as read - may need server restart');
      }
    } else {
      console.log('   ❓ "Keka Open" email not found in recent messages');
    }

    // Test 5: Check server version/deployment
    console.log('\n🔧 Server Information:');
    console.log('   If you recently deployed fixes, the server should have:');
    console.log('   - ✅ 15-second buffer for filtering quick opens');
    console.log('   - ✅ Better sender email detection');
    console.log('   - ✅ Improved recipient identification');
    console.log('   - ✅ Enhanced logging for debugging');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nPossible issues:');
    console.log('1. Production server is not running');
    console.log('2. CORS issues with production domain');
    console.log('3. Database connection problems');
    console.log('4. Code changes not deployed to production');
  }
}

checkProductionStatus();