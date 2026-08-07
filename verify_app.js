const { getUnifiedTracking } = require('./services/tracker');

async function testVerification() {
    console.log('----------------------------------------------------');
    console.log('Testing Morning Global MG ID: BR004453737MG');
    console.log('----------------------------------------------------');

    const result = await getUnifiedTracking('BR004453737MG', true);
    console.log('Success:', result.success);
    console.log('Tracking ID:', result.trackingId);
    console.log('Destination Tracking ID:', result.destinationTrackingId);
    console.log('Current Stage:', result.currentStage);
    console.log('Status Text:', result.statusText);
    console.log('Events Count:', result.eventsCount);
    console.log('\nParsed Events Summary:');
    result.events.forEach((ev, i) => {
        console.log(` ${i + 1}. [${ev.source}] ${ev.date} - ${ev.details || ev.status} @ ${ev.location}`);
    });
    console.log('----------------------------------------------------');
}

testVerification();
