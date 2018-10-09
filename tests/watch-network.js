var ChainScanner = require("../lib/ChainScanner").default

var scanner = new ChainScanner({
	log_level: "silent",
	peer_log_level: "silent",
	disableLogUpdate: false,
	network: "livenet",
	max_peers: 1000,
})

scanner.onReorgTrigger((obj) => {
	console.log("Fire Up SpartanBot!", obj)
})