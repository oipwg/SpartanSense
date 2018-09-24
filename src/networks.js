// Last Header Hash Info
// Livenet: 2018-09-01 1d6efe0910cd5f34bc60161cf57151480788a9a0c93272ae9fb2cdba4b9ff90d
// Testnet: 2018-08-31 3a43203dc8e90298281e9faecc8b1d21cdf5a1cce99690ec211569176b15366d

const flo_livenet = {
	name: 'main',
	alias: 'livenet',
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
	],
	lastHeaderHash: "1d6efe0910cd5f34bc60161cf57151480788a9a0c93272ae9fb2cdba4b9ff90d"
}

const flo_testnet = {
	name: 'testnet',
	alias: 'regtest',
	pubkeyhash: 115,
	privatekey: 239,
	scripthash: [198, 58],
	xpubkey: 0x013440e2,
	xprivkey: 0x01343c23,
	networkMagic: 0xfdc05af2,
	port: 17312,
	dnsSeeds: [
		'testnet.oip.fun'
	],
	lastHeaderHash: "3a43203dc8e90298281e9faecc8b1d21cdf5a1cce99690ec211569176b15366d"
}

const NETWORKS = [flo_livenet, flo_testnet]

export function getNetwork(string){
	for (let network of NETWORKS)
		if (string === network.name || string === network.alias)
			return network

	console.log("NO MATCH! " + string)
}