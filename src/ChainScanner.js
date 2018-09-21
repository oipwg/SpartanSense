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
	 * @param {String} [settings.peer_log_level="silent"] - Log Level for Peers
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
			this.settings.max_peers = 1000

		// Set default log level
		if (!this.settings.log_level)
			this.settings.log_level = "silent"

		// Set the logging level based on settings
		this.log = getLogger({prefix: "ChainScanner", level: this.settings.log_level})

		this.peers = {}
		this._lastDestroyedPeerCount = 0

		// Startup all listeners and loops
		this.startup()

		setInterval(() => {
			let map = this.generatePeerMap()
			this.log.info(JSON.stringify(map.peer_map, null, 4))
			this.log.info(this.inspect())
		}, 30 * 1000)
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
							this.addPeer(ip + ":" + this.settings.network.port)
						}
					}
				})
			}
		}
	}
	addPeer(peer){
		let total_ready = 0

		let peer_hash = sha256(new Buffer(peer)).toString('hex')

		// Peer Already Added
		if (this.peers[peer_hash])
			return

		for (let hash in this.peers){
			if (this.peers[hash].isOpen())
				total_ready++
		}

		if (total_ready >= this.settings.max_peers || Object.keys(this.peers).length >= this.settings.max_peers)
			return

		try {
			let new_peer = new Peer({
				network: this.settings.network,
				ip: peer,
				log_level: this.settings.peer_log_level || this.settings.log_level,
				onAddress: this.addPeer.bind(this),
				onDisconnect: this.rmPeer.bind(this)
			})

			this.peers[peer_hash] = new_peer

			new_peer.startup()
		} catch (e) {
			this.log.error(e)
		}
	}
	rmPeer(peer_hash){
		if (this.peers[peer_hash]){
			this._lastDestroyedPeerTime = Date.now()

			this.peers[peer_hash].destroy()
			delete this.peers[peer_hash]

			this._lastDestroyedPeerCount++
			// this.log.debug("Peer Destroyed " + peer_hash)
			// Only log occasionally
			setTimeout(()=>{
				if (Date.now() - this._lastDestroyedPeerTime >= 1000){
					if (!this._loggedLastDestroyed){
						this._loggedLastDestroyed = true
						this.log.debug(`Destroyed ${this._lastDestroyedPeerCount} Peers`)

						setTimeout(()=>{
							this._loggedLastDestroyed = false
							this._lastDestroyedPeerCount = 0
						}, 1000)
					}
				}
			}, 1000)
		}
	}
	generatePeerMap(){
		let peer_map = {}
		let chains = {}

		for (let peer_hash in this.peers){
			// If this peer hasn't finished syncing yet, don't add it to the map :) 
			if (!this.peers[peer_hash].initialSyncComplete)
				continue;

			let blockHeightMap = this.peers[peer_hash].blockHeightMap

			let chain_match = false

			for (let chain in chains){
				let single_chain_match = true

				for (let block_hash in blockHeightMap){
					let hash_matched = false
					for (let height in chains[chain]){
						if (chains[chain][height] === block_hash){
							hash_matched = true
							continue
						}
					}

					if (!hash_matched){
						single_chain_match = false
						continue
					}
				}

				if (single_chain_match)
					chain_match = chain
			}

			// console.log(chain_match + " " + Object.keys(blockHeightMap).length)

			let peer_map_match

			if (chain_match){
				peer_map_match = chain_match
			} else {
				let first_hash

				for (let block_hash in blockHeightMap){
					if (!first_hash)
						first_hash = block_hash

					if (!chains[first_hash])
						chains[first_hash] = {}

					chains[first_hash][blockHeightMap[block_hash]] = block_hash
				}

				if (!first_hash)
					continue

				peer_map_match = first_hash
			}

			if (!peer_map[peer_map_match])
				peer_map[peer_map_match] = { best_height: 0, best_hash: undefined, peers: [] }

			peer_map[peer_map_match].peers.push(this.peers[peer_hash].internal_peer.agent + " " + this.peers[peer_hash].getIP())

			if (peer_map[peer_map_match].best_height < this.peers[peer_hash].internal_peer.bestHeight)
				peer_map[peer_map_match].best_height = this.peers[peer_hash].internal_peer.bestHeight

			if (peer_map[peer_map_match].best_hash !== this.peers[peer_hash].lastRBlockHash)
				peer_map[peer_map_match].best_hash = this.peers[peer_hash].lastRBlockHash
		}

		return {peer_map, chains}
	}
	inspect(){
		let total_ready = 0
		let headers_synced = 0
		let blockes_synced = 0

		for (let hash in this.peers){
			if (this.peers[hash].isOpen())
				total_ready++

			if (this.peers[hash].headerSyncComplete)
				headers_synced++

			if (this.peers[hash].initialSyncComplete)
				blockes_synced++
		}

		return `<ChainScanner totalPeers={${Object.keys(this.peers).length}} readyPeers={${total_ready}} peerHeaderComplete={${headers_synced}} peerBlockComplete={${blockes_synced}} />`
	}
}

export default ChainScanner