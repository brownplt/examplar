const INTERVAL = 10000;
let last_time = Date.now();

setInterval(function () {
    let curr_time = Date.now();

    if (curr_time > (last_time + INTERVAL * 2)) {
        postMessage({sleep: last_time, wake: curr_time});
    }

    last_time = curr_time;

}, INTERVAL);
