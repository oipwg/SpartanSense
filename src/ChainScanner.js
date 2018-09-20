import getLogger from 'loglevel-colored-level-prefix'
import dns from 'dns'
import bitcore, { Networks } from 'bitcore-lib'

import Peer from './Peer'

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
	 * @param {Number} [settings.max_peers] - The maximum number of peers to connect to
	 * @param {String} [settings.log_level="silent"] - The level to log at
	 * @return {ChainScanner} Returns a live ChainScanner
	 */
	constructor(settings){
		// Save the users settings
		this.settings = settings || {}

		// Grab the network to use
		if (!this.settings.network){
			this.settings.network = Networks.get("flolivenet")
		} else if (typeof this.settings.network === "string"){
			this.settings.network = Networks.get(this.settings.network)
		} else {
			Networks.add(this.settings.network)
			this.settings.network = Networks.get(this.settings.network.name)
		}

		// Set a maximum default of peers
		if (!this.settings.max_peers)
			this.settings.max_peers = 1

		// Set default log level
		if (!this.settings.log_level)
			this.settings.log_level = "silent"

		// Set the logging level based on settings
		this.log = getLogger({prefix: "ChainScanner", level: this.settings.log_level})

		this.peers = []

		// Startup all listeners and loops
		this.startup()
	}
	startup(){
		this.log.info("Startup ChainScanner")
		// Grab peers from the DNS seeders
		this.getPeersFromDNS()
	}
	getPeersFromDNS(){
		if (this.settings.network.dnsSeeds){
			// Search each seeder listed
			for (let seed of this.settings.network.dnsSeeds){
				this.log.debug(`Resolving DNS seed (${seed})`)
				// Resolve peers for the DNS seed
				dns.resolve(seed, (err, ips) => {
					// ignore on error...
					// Go through IP's returned by the DNS search
					if (ips && Array.isArray(ips)){
						this.log.info(`Resolved ${ips.length} ips from DNS seed (${seed})`)
						for (let ip of ips){
							this.addPeer({ ip: { v4: ip } })
						}
					}
				})
			}
		}
	}
	addPeer(peer){
		let total_ready = 0

		let peer_hash = sha256(new Buffer(peer.ip.v6 + peer.ip.v4 + peer.port || this.settings.network.port)).toString('hex')

		for (let p of this.peers){
			if (p.isOpen())
				total_ready++

			if (p.getHash() === peer_hash){
				// If we found a match, return and stop the add/connect
				return
			}
		}

		if (total_ready >= this.settings.max_peers || this.peers.length >= this.settings.max_peers)
			return

		let new_peer = new Peer({
			network: this.settings.network,
			ip: peer.ip,
			port: peer.port,
			log_level: this.settings.log_level,
			onAddress: this.addPeer.bind(this)
		})

		this.peers.push(new_peer)

		new_peer.startup()
	}
	fillConnections(){

	}
}

export default ChainScanner