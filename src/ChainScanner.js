import dns from 'dns'
import bitcore, { Networks } from 'bitcore-lib'
import { Peer, Messages } from 'bitcore-p2p'

// Grab the networks
import { flo_livenet, flo_testnet } from './networks'

const sha256 = bitcore.crypto.Hash.sha256

// Add both the networks
Networks.add(flo_livenet)
Networks.add(flo_testnet)

class ChainScanner {
	/**
	 * Create a new Chain Scanner
	 * @param {Object} [settings] - The settings for Chain Scanner
	 * @param {String} [settings.network="flolivenet"] - The network to scan
	 * @param {Number} [settings.max_peers] - The maximum number of peers to conenct to
	 * @return {ChainScanner} Returns a live ChainScanner
	 */
	constructor(settings){
		// Save the users settings
		this.settings = settings || {}

		// Grab the network to use
		if (!this.settings.network)
			this.settings.network = flo_livenet
		else if (this.settings.network === "flolivenet")
			this.settings.network = flo_livenet
		else if (this.settings.network === "flotestnet")
			this.settings.network = flo_testnet
		else
			Networks.add(this.settings.network)

		// Set a maximum default of peers
		if (!this.settings.max_peers)
			this.settings.max_peers = 1000

		// Create messages formatted with our network info
		this.messages = new Messages({network: this.settings.network.name})

		this.peers = []
		this.connected_peers = {}

		// Startup all listeners and loops
		this.startup()
	}
	startup(){
		// Grab peers from the DNS seeders
		this.getPeersFromDNS()
	}
	getPeersFromDNS(){
		if (this.settings.network.dnsSeeds){
			// Search each seeder listed
			for (let seed of this.settings.network.dnsSeeds){
				// Resolve peers for the DNS seed
				dns.resolve(seed, (err, ips) => {
					// ignore on error...
					// Go through IP's returned by the DNS search
					if (ips && Array.isArray(ips)){
						for (let ip of ips){
							this.addPeer({ ip: { v4: ip } })
						}

						console.log(this.peers)
					}
				})
			}
		}
	}
	addPeer(peer){
		// Set the peers port if undefined
		peer.port = peer.port || this.settings.network.port

		// Create a hash of the peer
		peer.hash = sha256(new Buffer(peer.ip.v6 + peer.ip.v4 + peer.port)).toString('hex')

		for (let p of this.peers){
			if (p.hash === peer.hash){
				// If we found a match, return and stop the add/connect
				return
			}
		}

		this.peers.push(peer)

		this.connectToPeer(peer)
	}
	connectToPeer(){
	}
	removeConnectedPeer(){

	}
	fillConnections(){

	}
}

export default ChainScanner