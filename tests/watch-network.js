var ChainScanner = require("../lib/ChainScanner").default

var scanner = new ChainScanner({
	log_level: "debug",
	peer_log_level: "debug",
	network: "livenet",
	max_peers: 1000,
})