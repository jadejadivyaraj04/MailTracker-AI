#!/usr/bin/env node

// Script to investigate why opens are getting tagged with wrong recipient emails

const BASE_URL = 'http://localhost:5000';

async function investigateFalsePositive() {
  const messageUid = '751e5d16-0149-40a2-9c29-70745c483eff'; // Your "Keka Open" email
  
  console.log('🔍 Investigating False Positive');
  console.log('===============================');
  console.log(`Message UID: ${messageUid}\n`);

  try {
    // Get debug info
    const response = await fetch(`${BASE_URL}/debug/track/${messageUid}`);
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('📧 Message Analysis:');
    console.log(`   Subject: "${data.message?.subject}"`);
    console.log(`   Sender: ${data.message?.senderEmail}`);
    console.log(`   Sent: ${new Date(data.message?.sentAt).toLocaleString()}`);
    console.log(`   Recipients:`);
    console.log(`     To: ${JSON.stringify(data.message?.recipients?.to || [])}`);
    console.log(`     CC: ${JSON.stringify(data.message?.recipients?.cc || [])}`);
    console.log(`     BCC: ${JSON.stringify(data.message?.recipients?.bcc || [])}`);
    
    console.log('\n🔑 Token Analysis:');
    const tokens = data.message?.recipientTokens || {};
    Object.entries(tokens).forEach(([email, token]) => {
      console.log(`   ${email}: ${token}`);
    });
    
    console.log('\n📖 Open Event Analysis:');
    if (data.opens.length > 0) {
      data.opens.forEach((open, i) => {
        console.log(`\n   Open ${i + 1}:`);
        console.log(`     Recipient Email: ${open.recipientEmail || 'NULL'}`);
        console.log(`     Token: ${open.token || 'NULL'}`);
        console.log(`     Time: ${open.timeSinceSent?.toFixed(3)}s after send`);
        console.log(`     User Agent: ${open.userAgent?.substring(0, 80)}...`);
        console.log(`     IP Hash: ${open.ipHash}`);
        console.log(`     Is Proxy: ${open.isProxy}`);
        console.log(`     Created: ${new Date(open.createdAt).toLocaleString()}`);
        
        // Analysis
        console.log(`\n     🔍 Analysis:`);
        
        // Check if token matches
        if (open.token && tokens[open.recipientEmail]) {
          const expectedToken = tokens[open.recipientEmail];
          const tokenMatches = open.token === expectedToken;
          console.log(`       Token Match: ${tokenMatches ? '✅ YES' : '❌ NO'}`);
          if (!tokenMatches) {
            console.log(`       Expected: ${expectedToken}`);
            console.log(`       Got: ${open.token}`);
          }
        } else if (!open.token) {
          console.log(`       Token Match: ❌ NO TOKEN PROVIDED`);
          console.log(`       This suggests the pixel URL didn't include a token`);
        }
        
        // Check timing
        const timeDiff = open.timeSinceSent || 0;
        if (timeDiff < 5) {
          console.log(`       Timing: 🚨 VERY SUSPICIOUS (${timeDiff.toFixed(3)}s - likely sender preview)`);
        } else if (timeDiff < 15) {
          console.log(`       Timing: ⚠️  SUSPICIOUS (${timeDiff.toFixed(3)}s - possibly sender preview)`);
        } else {
          console.log(`       Timing: ✅ REASONABLE (${timeDiff.toFixed(3)}s - likely real open)`);
        }
        
        // Check user agent
        const ua = open.userAgent || '';
        if (ua.includes('Chrome') && ua.includes('Macintosh')) {
          console.log(`       User Agent: 🤔 DESKTOP CHROME (could be sender or recipient)`);
        } else if (ua.includes('Mobile')) {
          console.log(`       User Agent: 📱 MOBILE (more likely recipient)`);
        } else if (ua.includes('googleimageproxy') || ua.includes('via ggpht.com')) {
          console.log(`       User Agent: 🤖 EMAIL PROXY (Gmail prefetch)`);
        }
        
        // Overall assessment
        const isSender = data.message?.senderEmail === open.recipientEmail;
        const isQuick = timeDiff < 15;
        const hasToken = !!open.token;
        
        console.log(`\n     🎯 Assessment:`);
        if (isSender) {
          console.log(`       🚨 DEFINITELY FALSE: Sender viewing own email`);
        } else if (isQuick && !hasToken) {
          console.log(`       🚨 LIKELY FALSE: Quick open without token`);
        } else if (isQuick && hasToken) {
          console.log(`       ⚠️  SUSPICIOUS: Quick but has token - investigate pixel URL`);
        } else {
          console.log(`       ✅ LIKELY LEGITIMATE: Good timing and/or token`);
        }
      });
    } else {
      console.log('   No opens recorded');
    }
    
    console.log('\n🔧 Recommendations:');
    
    const firstOpen = data.opens[0];
    if (firstOpen && firstOpen.timeSinceSent < 5) {
      console.log('   1. ❌ This open happened too quickly (< 5s) to be a real recipient');
      console.log('   2. 🔍 This is likely you viewing the email in Gmail\'s "Sent" folder');
      console.log('   3. 🛠️  The system should filter this out with stricter time buffer');
      
      if (!firstOpen.token) {
        console.log('   4. 🚨 No token suggests the pixel URL was malformed');
        console.log('   5. 🔧 Check if tracking pixels are being generated correctly');
      } else {
        console.log('   4. 🤔 Has token but still suspicious - check pixel generation logic');
      }
    }
    
    console.log('\n💡 Next Steps:');
    console.log('   1. Restart server with stricter 15-second buffer');
    console.log('   2. Send a new test email');
    console.log('   3. Do NOT open the sent email immediately');
    console.log('   4. Wait 30+ seconds, then have recipient open it');
    console.log('   5. Check if timing-based filtering works correctly');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

investigateFalsePositive();