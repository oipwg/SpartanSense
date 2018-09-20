export const flo_livenet = {
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

export const flo_testnet = {
	name: 'flotestnet',
	alias: 'floregtest',
	pubkeyhash: 115,
	privatekey: 239,
	scripthash: [198, 58],
	xpubkey: 0x013440e2,
	xprivkey: 0x01343c23,
	networkMagic: 0xfdc05af2,
	port: 17312,
	dnsSeeds: [
		'testnet.oip.fun'
	]
}