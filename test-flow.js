
const MAILTRACKER_BACKEND_BASE = 'https://mailtracker-ai.onrender.com';

const testRegistration = async () => {
    const uid = `test-${Date.now()}`;
    const email = 'debug@example.com';

    console.log(`[Test] Registering message UID: ${uid} for user: ${email}`);

    try {
        const response = await fetch(`${MAILTRACKER_BACKEND_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid,
                recipients: { to: ['test@recipient.com'] },
                subject: 'Debug Test Email',
                senderEmail: email,
                timestamp: new Date().toISOString(),
                userId: email // Explicitly setting userId
            })
        });

        if (!response.ok) {
            console.error(`[Test] Registration Failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(`[Test] Response: ${text}`);
            return;
        }

        const result = await response.json();
        console.log('[Test] Message registered:', result);

        console.log('[Test] Now fetching stats...');
        // Wait a moment for DB propagation
        await new Promise(r => setTimeout(r, 1000));

        const statsResponse = await fetch(`${MAILTRACKER_BACKEND_BASE}/stats/user/${encodeURIComponent(email)}`);
        const stats = await statsResponse.json();

        console.log(`[Test] Stats for ${email}:`);
        console.log(`[Test] Total Messages: ${stats.totalMessages}`);
        console.log(`[Test] Messages Found:`);
        stats.messages.forEach(m => {
            console.log(`   - ${m.uid}: ${m.subject} (Opens: ${m.openCount})`);
        });

        if (stats.messages.find(m => m.uid === uid)) {
            console.log('\n✅ SUCCESS: Message successfully registered and retrieved!');
        } else {
            console.log('\n❌ FAILURE: Message registered but NOT found in stats.');
        }

    } catch (error) {
        console.error('[Test] Error:', error);
    }
};

testRegistration();
