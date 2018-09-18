var Networks = require('bitcore-lib').Networks;
var Pool = require('bitcore-p2p').Pool;
var Messages = require('bitcore-p2p').Messages;

var flo_network = {
	name: 'flolivenet',
	alias: 'flomainnet',
	pubkeyhash: 35,
	privatekey: [176, 163], // 176 is Litecoin
	scripthash: [8, 94],
	xpubkey: 0x0134406b,
	xprivkey: 0x01343c31,
	networkMagic: 0xfdc0a5f1, // 0xfdc0a5f1
	port: 7312,
	dnsSeeds: [
		'seed1.florincoin.org',
		'flodns.oip.li',
		'flodns.oip.fun',
		'flodns.seednode.net'
	]
}

Networks.add(flo_network)

var flo_messages = new Messages({network: "flolivenet"})

Pool.MaxConnectedPeers = 1000

var pool = new Pool({network: "flolivenet"});

var connected_peers = {}
var available_blocks = {}

// connect to the network
pool.connect();
pool.listen();

// attach peer events
pool.on('peerinv', function(peer, message) {
  // a new peer message has arrived
  console.log("Peer Inv!")
  connected_peers[peer.host] = {
  	bestHeight: peer.bestHeight,
  	version: peer.version,
  	subversion: peer.subversion,
  	host: peer.host
  }

  for (var inv of message.inventory){
  	// 2 = block
  	if (inv.type === 2){
  		console.log(inv.hash.toString('hex'))
  		console.log(flo_messages.parseBuffer(inv.hash))
  		// available_blocks[inv.hash.toString()] = 
  	}
  }

  console.log(message.inventory)
});

pool.sendMessage(new Messages.GetBlocks({network: "flolivenet"}))

setInterval(function(){
	var chain_heights = {}

	for (var peer in connected_peers){
		var bestHeight = connected_peers[peer].bestHeight
		var peerHost = connected_peers[peer].host

		if (!chain_heights[bestHeight])
			chain_heights[bestHeight] = { peers: [] }

		if (chain_heights[bestHeight].peers.indexOf(peerHost) === -1)
			chain_heights[bestHeight].peers.push(peerHost)
	}

	for (var height in chain_heights){
		chain_heights[height].numer_of_peers = chain_heights[height].peers.length
		delete chain_heights[height].peers
	}

	console.log(pool.inspect())

// 	logUpdate(
// `
// Pool Info: ${pool.inspect()}

// Chain Heights ${JSON.stringify(chain_heights, null, 4)}
// `
// 	)
}, 1000)

// will disconnect all peers
// pool.disconnect()