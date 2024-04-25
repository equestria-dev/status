process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const YAML = require('yaml');
const axios = require('axios').default;
const fs = require('fs');
const net = require('net');
const ejs = require('ejs');
const history = require("./history.json");
const dgram = require("dgram");

const blobToken = require("./public/.vercel/project.json")["blob"];
const blob = require('@vercel/blob');

if (!fs.existsSync("./pings.json")) fs.writeFileSync("./pings.json", "{}");

global.config = YAML.parse(fs.readFileSync("./config.yaml").toString());
global.output = {};

function rgb2hue(r,g,b) {
    let v=Math.max(r,g,b), c=v-Math.min(r,g,b), f=(1-Math.abs(v+v-c-1));
    let h= c && ((v===r) ? (g-b)/c : ((v===g) ? 2+(b-r)/c : 4+(r-g)/c));
    return 60*(h<0?h+6:h);
}

function testPort(port, host, udp) {
    return new Promise((res, rej) => {
        if (udp) {
            let timeout;

            let client = dgram.createSocket('udp4');
            let message = Buffer.from("Equestria.dev-Status-Test_1.0");

            client.send(message, 0, message.length, port, host, function(err) {
                if (err) rej(err);
                clearTimeout(timeout);
                client.close();
                res();
            });

            timeout = setTimeout(() => {
                client.close();
                rej(new Error("Connection timed out"));
            }, config['timeout']);
        } else {
            let timeout;

            let socket = net.createConnection(port, host).on("connect", function(e) {
                clearTimeout(timeout);
                socket.destroy();
                res(e);
            }).on("error", function(e) {
                clearTimeout(timeout);
                rej(e);
            });

            timeout = setTimeout(() => {
                socket.destroy();
                rej(new Error("Connection timed out"));
            }, config['timeout']);
        }
    })
}

async function check() {
    global.pingHistory = JSON.parse(fs.readFileSync("./pings.json").toString());
    global.config = YAML.parse(fs.readFileSync("./config.yaml").toString());
    global.output = {};
    global.groups = [];

    for (let item of config['services']) {
        console.log(`[${item.id}] ${item.name}`);
        item.group = "";

        let result, start, ping;

        global.groups = [...new Set([...global.groups, item.group])];

        switch (item.type) {
            case "http":
            case "https":
                let url = item.type + "://" + item.host + ":" + item.port + "/" + item.url

                start = new Date().getTime();
                console.error("    Fetching:", url);

                try {
                    result = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 EquestriaStatus/0.0 (compatible; Status-Poller; +https://status.equestria.dev)' }, timeout: config.timeout });
                } catch (e) {
                    result = e;
                }

                if (result.message && result.message.startsWith("Request failed with status code ")) {
                    result.status = parseInt(result.message.substring(32));
                }

                ping = new Date().getTime() - start;
                console.log("    Response: " + result.status, result.statusText, result);

                if (result.status === item.expect) {
                    if (ping > config['slow']) {
                        console.log("    Is expected, but service is slow, marking as misbehaving");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "notWorking",
                            details: "The service is reachable from an off-site network, but it is running with degraded performance.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    } else {
                        console.log("    Is expected, marking as online");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "online",
                            details: "The service is entirely operational and responds within a reasonable amount of time.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    }
                } else if (result.status < 500) {
                    console.log("    Is unexpected, marking as misbehaving");
                    output[item.id] = {
                        id: item.id,
                        name: item.name,
                        group: item.group ?? "Default",
                        ping,
                        status: "notWorking",
                        details: "The service is reachable from an off-site network, but does not behave like it should (warning code: " + result.status + ").",
                        type: item.category ?? null,
                        hosting: item.hosting ?? null
                    }
                } else if (result.status) {
                    console.log("    Is unexpected, marking as offline");
                    output[item.id] = {
                        id: item.id,
                        name: item.name,
                        group: item.group ?? "Default",
                        ping,
                        status: "offline",
                        details: "The service returns a server error upon connection (error code: " + result.status + ").",
                        type: item.category ?? null,
                        hosting: item.hosting ?? null
                    }
                } else {
                    console.log("    Is unexpected, marking as offline");
                    output[item.id] = {
                        id: item.id,
                        name: item.name,
                        group: item.group ?? "Default",
                        ping,
                        status: "offline",
                        details: "The service is currently unreachable from an off-site network (error message: " + result.message + ").",
                        type: item.category ?? null,
                        hosting: item.hosting ?? null
                    }
                }

                break;

            case "tcp":
                console.error("    Fetching:", "tcp://" + item.host + ":" + item.port);

                try {
                    start = new Date().getTime();
                    result = await testPort(item.port, item.host);
                    ping = new Date().getTime() - start;

                    console.log("    Result: -");
                    if (ping > config['slow']) {
                        console.log("    Is expected, but service is slow, marking as misbehaving");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "notWorking",
                            details: "The service is reachable from an off-site network, but it is running with degraded performance.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    } else {
                        console.log("    Is expected, marking as online");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "online",
                            details: "The service is entirely operational and responds within a reasonable amount of time.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    }
                } catch (e) {
                    ping = new Date().getTime() - start;

                    if (e.message === "Connection timed out") {
                        console.log("    Result: (timed out)");
                        console.log("    Is unexpected, marking as misbehaving");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "notWorking",
                            details: "The service is potentially reachable from an off-site network, but the attempt to connect took longer than the maximum allowed time.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    } else {
                        console.log("    Result:", e.code);
                        console.log("    Is unexpected, marking as offline");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "offline",
                            details: "The service is currently unreachable from an off-site network (error code: " + e.code + ").",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    }
                }

                break;

            case "udp":
                console.error("    Fetching:", "udp://" + item.host + ":" + item.port);

                try {
                    start = new Date().getTime();
                    result = await testPort(item.port, item.host, true);
                    ping = new Date().getTime() - start;

                    console.log("    Result: -");
                    if (ping > config['slow']) {
                        console.log("    Is expected, but service is slow, marking as misbehaving");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "notWorking",
                            details: "The service is reachable from an off-site network, but it is running with degraded performance.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    } else {
                        console.log("    Is expected, marking as online");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "online",
                            details: "The service is entirely operational and responds within a reasonable amount of time.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    }
                } catch (e) {
                    ping = new Date().getTime() - start;

                    if (e.message === "Connection timed out") {
                        console.log("    Result: (timed out)");
                        console.log("    Is unexpected, marking as misbehaving");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "notWorking",
                            details: "The service is potentially reachable from an off-site network, but the attempt to connect took longer than the maximum allowed time.",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    } else {
                        console.log("    Result:", e.code);
                        console.log("    Is unexpected, marking as offline");
                        output[item.id] = {
                            id: item.id,
                            name: item.name,
                            group: item.group ?? "Default",
                            ping,
                            status: "offline",
                            details: "The service is currently unreachable from an off-site network (error code: " + e.code + ").",
                            type: item.category ?? null,
                            hosting: item.hosting ?? null
                        }
                    }
                }

                break;

            default:
                console.error("    Unrecognized service type:", item.type);
                output[item.id] = {
                    id: item.id,
                    name: item.name,
                    group: item.group ?? "Default",
                    ping: -1,
                    status: null,
                    details: "An error occurred while processing status for this service.",
                    type: item.category ?? null,
                    hosting: item.hosting ?? null
                };
                break;
        }

        if (item['maintenance']) {
            output[item.id]["status"] = "maintenance";

            if (typeof item['maintenance'] !== "string" || item['maintenance'].trim() === "") {
                output[item.id]["details"] = "The administrators have indicated this service is temporarily under maintenance and may not behave as it normally does.";
            } else {
                output[item.id]["details"] = item['maintenance'];
            }
        }
    }

    let pings = Object.values(output).map((i) => {
        return i["ping"];
    }).filter((i) => i > 0);

    global.output = {
        services: Object.values(output).sort((a, b) => {
            return a['name'].localeCompare(b['name']);
        }),
        ping: pings.reduce((a, b) => a + b) / pings.length,
        date: new Date(),
        total: 0,
        groups: groups
    }

    let history = require('./history.json');

    for (let service of output.services) {
        if (!history[service.id]) history[service.id] = {};
        if (!history[service.id][new Date().toISOString().split("T")[0]]) history[service.id][new Date().toISOString().split("T")[0]] = [];

        let code = 0;

        if (service.status === "offline") code = 2;
        if (service.status === "notWorking") code = 1;
        if (service.status === "maintenance") code = 3;

        history[service.id][new Date().toISOString().split("T")[0]].push(code);

        let newHistory = {};
        let days = Object.keys(history[service.id]);
        let keepDays = [];

        for (let day of days) {
            if (new Date(new Date().toISOString().split("T")[0]).getTime() - new Date(day).getTime() >= 7776000000) {} else {
                keepDays.push(day);
            }
        }

        for (let day of keepDays) {
            newHistory[day] = history[service.id][day];
        }

        history[service.id] = newHistory;
    }

    fs.writeFileSync("./history.json", JSON.stringify(history));

    if (global.output.services.map(i => i.status).includes("offline")) {
        global.output.total = 2;
    } else if (global.output.services.map(i => i.status).includes("notWorking")) {
        global.output.total = 1;
    }

    fs.writeFileSync("output.json", JSON.stringify(output, null, 4));
    fs.writeFileSync("git/status.json", JSON.stringify({
        ping: output["ping"],
        code: output['total'],
        image: output['total'] === 2 ? "status-error" : (output['total'] === 1 ? "status-warning" : "status-ok"),
        text: output['total'] === 2 ? "Servers outage" : (output['total'] === 1 ? "Degraded performance" : "All systems nominal"),
        outages: Object.values(output.services).filter(i => i["status"] === "offline" || i["status"] === "notWorking").map(i => [null, i.name])
    }, null, 4));

    pingHistory[new Date().toISOString()] = pings.reduce((a, b) => a + b) / pings.length;
    let newPingHistory = {};

    for (let key of Object.keys(pingHistory).splice(-576)) {
        newPingHistory[key] = pingHistory[key];
    }

    fs.writeFileSync("./pings.json", JSON.stringify(newPingHistory, null, 4));
}

async function web() {
    console.log("Generating webpage...");
    let uptimes = {};

    for (let i = 89; i > -1; i--) {
        let date = new Date(new Date(new Date().toISOString().split("T")[0]).getTime() - 86400000 * i).toISOString().split("T")[0];
        let services = Object.values(output["services"]).map(i => i.id);
        let list = [];

        for (let service of services) {
            if (history[service]) {
                if (history[service][date]) {
                    list.push(...history[service][date]);
                }
            }
        }

        let perType = [0, 0, 0, 0];

        for (let item of list) {
            perType[item]++;
        }

        let total = perType.reduce((a, b) => a + b);
        perType = perType.map(i => (i / total) * 100);

        uptimes[date] = perType;
    }

    let publicData = JSON.stringify({
        global: output["total"],
        ping: output['ping'],
        time: output['date'],
        breakdown: uptimes,
        services: output['services'].map(i => {
            return {
                id: require('crypto').createHash('md5').update(i.id).digest("hex"),
                label: i.name,
                ping: i.ping,
                status: i.status === "online" ? 0 : (i.status === "notWorking" ? 1 : (i.status === "offline" ? 2 : 3)),
                type: i.type,
                hosting: i.hosting ?? "equestriadev"
            }
        }),
        notice: config['outage']['enabled'] ? config['outage'] : null,
    });

    fs.writeFileSync("./public.json", publicData);
    fs.copyFileSync("./public.json", "./git/public.json");
    require('child_process').exec("git add -A && git commit -m \"$(date)\" && git push origin master", { cwd: "./git" });

    await blob.put("public/status.json", publicData, {
        access: "public",
        addRandomSuffix: false,
        token: blobToken,
        cacheControlMaxAge: 360
    });
    await blob.put("public/api.json", fs.readFileSync("./git/status.json"), {
        access: "public",
        addRandomSuffix: false,
        token: blobToken,
        cacheControlMaxAge: 360
    });

    console.log("Done!");
}

async function notifications() {
    console.log("Dispatching notifications");
    await require('./notifications')();
    console.log("Done!");
}

(async () => { await check(); await notifications(); await web(); console.log("Update completed"); setInterval(async () => { await check(); await notifications(); await web(); }, config['interval']); })()
