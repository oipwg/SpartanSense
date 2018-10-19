import fs from 'fs'
import getLogger from 'loglevel-colored-level-prefix'
import dns from 'dns'
import bitcore from 'bitcore-lib'
import { fullnode as FullNode } from 'fcoin'
import common from 'fcoin/lib/mining/common'
import ora from 'ora'
import logSymbols from 'log-symbols'
import logUpdate from 'log-update'
import EventEmitter from 'eventemitter3'

import Peer from './Peer'

// Grab the networks
import { getNetwork } from './networks'

const sha256 = bitcore.crypto.Hash.sha256

class ChainScanner {
	/**
	 * Create a new Chain Scanner
	 * @param {Object} [settings] - The settings for Chain Scanner
	 * @param {String} [settings.network="livenet"] - The network to scan
	 * @param {Number} [settings.max_peers] - The maximum number of peers to connect to
	 * @param {String} [settings.log_level="silent"] - The level to log at
	 * @param {String} [settings.peer_log_level="silent"] - Log Level for Peers
	 * @param {String} [settings.disableLogUpdate=false] - Set this to true to disable logging of updates
	 * @return {ChainScanner} Returns a live ChainScanner
	 */
	constructor(settings){
		// Save the users settings
		this.settings = settings || {}

		// Grab the network to use
		if (this.settings.network){
			this.settings.network = getNetwork(settings.network)
		} else {
			this.settings.network = getNetwork("livenet")
		}

		// Set a maximum default of peers
		if (!this.settings.max_peers)
			this.settings.max_peers = 1000

		// Set default log level
		if (!this.settings.log_level)
			this.settings.log_level = "silent"

		// Set the default reorg trigger length. Currently defaults to a 10 block reorg
		if (!this.settings.reorg_trigger_length)
			this.settings.reorg_trigger_length = 10

		// Only trigger a reorg if the tip is recent
		if (!this.settings.reorg_tip_maxage)
			this.settings.reorg_tip_maxage = 25

		// Set the logging level based on settings
		this.log = getLogger({prefix: "ChainScanner", level: this.settings.log_level})

		this.peers = {}
		this._lastDestroyedPeerCount = 0

		// Startup all listeners and loops
		this.startup()
	}
	startup(){
		this.log.info("Startup ChainScanner")

		// Log the Status
		if (!this.settings.disableLogUpdate)
			setInterval(() => { logUpdate(this.logStatus()) }, 50)

		// Startup fcoin full node
		this.startFullNode()
		// Grab peers from the DNS seeders
		this.getPeersFromDNS()

		// Update stalled peers every 60 seconds
		setInterval(() => { this.updateStalledPeers() }, 60 * 1000)
	}
	async startFullNode(){
		let fcoin_dir = this.settings.prefix || `${__dirname}/fcoin-${this.settings.network.name}`
		if (!fs.existsSync(fcoin_dir)){
			fs.mkdirSync(fcoin_dir);
		}

		this.full_node = new FullNode({
			network: this.settings.network.name,
			db: 'leveldb',
			prefix: fcoin_dir,
			workers: true,
			"log-file": false,
			"log-level": "debug",
			"log-console": false,
			checkpoints: true,
			selfish: true
		});

		await this.full_node.open();
		await this.full_node.connect();
		// process.exit()
		try {
			this.full_node.startSync();

			// Update chain tips every 5 seconds
			setInterval(() => { this.chainTipsUpdateCycle() }, 5000)
		} catch (e) {
			console.log(e)
		}
	}
	async chainTipsUpdateCycle(){
		if (!this.emitter)
			this.emitter = new EventEmitter()

		this.chaintips = await this.full_node.rpc.getChainTips([])

		if (!this.chaintips)
			return

		this.best_active_tip = { height: 0 }
		this.other_tips = []
		for (let tip of this.chaintips){
			if (tip.status === "active"){
				if (tip.height > this.best_active_tip.height)
					this.best_active_tip = tip
			} else {
				// Check if we have reached a branch length where we should fire a reorg notification event
				if (tip.branchlen >= this.settings.reorg_trigger_length){
					// Check to make sure this is actually a recent tip, and not super old.
					if (tip.height >= (this.best_active_tip.height - this.settings.reorg_tip_maxage)){
						// Note that the "reorg_tip" in this case will likely be the "old" chain at the beginning
						if (!this.subscribed){
							this.subscribed = true
							this.emitter.on("reorgTrigger", this.subscriber)
						}

						this.emitter.emit("reorgTrigger", { best_height_tip: this.best_active_tip, reorg_tip: tip }, this)
					}
				}

				this.other_tips.push(tip)
			}
		}
	}
	onReorgTrigger(subscriber){
		this.subscribed = false
		this.subscriber = subscriber
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
	rmPeer(peer_hash, restart){
		if (this.peers[peer_hash]){
			let peer_ip = this.peers[peer_hash].getIP()

			this._lastDestroyedPeerTime = Date.now()

			this.peers[peer_hash].destroy()
			delete this.peers[peer_hash]

			this._lastDestroyedPeerCount++

			if (restart){
				this.addPeer(peer_ip)
			}

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
	/**
	 * Request new blocks on Peers that are hung
	 */
	updateStalledPeers(){
		// Get the best block height
		let best_height = 0
		for (let peer_hash in this.peers)
			if (this.peers[peer_hash].internal_peer.bestHeight > best_height)
				best_height = this.peers[peer_hash].internal_peer.bestHeight

		// Check the best height of each peer against the found best height
		// Request new Blocks if the best height is under the height
		for (let peer_hash in this.peers)
			if (this.peers[peer_hash].internal_peer.bestHeight < best_height && this.peers[peer_hash].headerSyncComplete && this.peers[peer_hash].requested_blocks.length === 0)
				this.peers[peer_hash].requestBlocks()
	}
	/**
	 * Grab a formatted status for the ChainScanner
	 * @return {String}
	 */
	logStatus(){
		let logString = ""

		if (!this.log_data)
			this.log_data = {}

		// Get the highest height
		let best_height = 0
		let peers_open = 0
		let num_peers_complete = 0
		for (let peer_hash in this.peers){
			if (this.peers[peer_hash].internal_peer.bestHeight > best_height)
				best_height = this.peers[peer_hash].internal_peer.bestHeight

			if (this.peers[peer_hash].isOpen())
				peers_open++
			if (this.peers[peer_hash].initialSyncComplete)
				num_peers_complete++
		}

		// Update logged info for the Full Node
		if (!this.log_data.full_node) this.log_data.full_node = { spinner: ora({text: "Starting up Full Node", color: "gray"}) }

		if (best_height < this.full_node.chain.height)
			best_height = this.full_node.chain.height

		if (this.full_node.chain.synced && (best_height !== 0 && this.full_node.chain.height >= best_height)){
			this.log_data.full_node.complete = true
			this.log_data.full_node.spinner.text = `Full Node Synced ${this.full_node.chain.height}`
		}
		else if (this.full_node.chain.height > -1){
			let header_height = undefined
			if (this.full_node.pool && this.full_node.pool.headerChain && this.full_node.pool.headerChain.tail && this.full_node.pool.headerChain.tail.height)
				header_height = this.full_node.pool.headerChain.tail.height

			this.log_data.full_node.spinner.color = "cyan"
			this.log_data.full_node.spinner.text = `Full Node Syncing... ${this.full_node.chain.height}/${best_height} ${((this.full_node.chain.height / best_height) * 100).toFixed(2)}% ${header_height ? `(Header Height ${header_height})` : ""}`
		}

		// Update logged info for Chain Tips
		if (!this.log_data.chaintips)
			this.log_data.chaintips = { spinner: ora("") }

		let best_active_tip = { height: 0, hash: undefined }
		let other_tips = []
		if (this.chaintips){
			for (let tip of this.chaintips){
				if (tip.status === "active"){
					if (tip.height > best_active_tip.height)
						best_active_tip = tip
				} else {
					other_tips.push(tip)
				}
			}
		}

		if (best_active_tip.height === best_height)
			this.log_data.chaintips.complete = true
		else
			this.log_data.chaintips.complete = false

		// Add Peer section
		if (!this.log_data.peers) this.log_data.peers = { main_spinner: ora({text: `${Object.keys(this.peers).length} Peers`, color: "yellow"}) }

		this.log_data.peers.main_spinner.text = `${peers_open} Peers Connected, ${num_peers_complete} Peers Synced (${Object.keys(this.peers).length - peers_open} connecting)`

		// Remove all peers that have been disconnected
		for (let p_hash in this.log_data.peers){
			let match = false

			for (let peer_hash in this.peers)
				if (p_hash === peer_hash) match = true

			if (!match && p_hash !== "main_spinner" && p_hash !== "completed")
				delete this.log_data.peers[p_hash]
		}

		// Update logged info for all Peers
		let peers_complete = true
		for (let peer_hash in this.peers){
			let ip = this.peers[peer_hash].getIP()
			let peer_height = this.peers[peer_hash].internal_peer.bestHeight

			if (!this.log_data.peers[peer_hash] && this.peers[peer_hash].isOpen())
				this.log_data.peers[peer_hash] = { spinner: ora({text: `Connecting... ${ip}`}) }

			if (this.log_data.peers[peer_hash])
				this.log_data.peers[peer_hash].height = peer_height

			if (this.peers[peer_hash].initialSyncComplete){
				this.log_data.peers[peer_hash].complete = true

				this.log_data.peers[peer_hash].spinner.text = `Peer Synced ${peer_height} (${this.peers[peer_hash].lastRBlockHash}) ${this.peers[peer_hash].internal_peer.agent} ${ip}`
			}
			else if (this.peers[peer_hash].headerSyncComplete){
				peers_complete = false

				let peerSyncPercent = ((peer_height/best_height) * 100).toFixed(2)
				this.log_data.peers[peer_hash].spinner.text = `Downloading Blocks... ${peer_height}/${best_height} ${peerSyncPercent}% (${this.peers[peer_hash].lastRBlockHash}) ${this.peers[peer_hash].internal_peer.agent} ${ip}`
			}
			else if (this.peers[peer_hash].isOpen()){
				peers_complete = false

				this.log_data.peers[peer_hash].spinner.text = `Downloading Headers... (${this.peers[peer_hash].lastHeaderHash}) ${this.peers[peer_hash].internal_peer.agent} ${ip}`
			}
		}

		// Write the logs for full nodes
		if (!this.log_data.full_node.complete)
			logString += this.log_data.full_node.spinner.frame() + "\n"
		else
			logString += `${logSymbols.success} ${this.log_data.full_node.spinner.text} \n`

		if (this.chaintips){
			if (!this.log_data.chaintips.complete){
				let tip_frame = this.log_data.chaintips.spinner.frame()

				logString += `${tip_frame}Chain Tips \n`
				logString += `\t - ${tip_frame}Active (best): ${best_active_tip.height} (${best_active_tip.hash})\n`
			} else {
				logString += `${logSymbols.success} Chain Tips \n`
				logString += `\t - ${logSymbols.success} Active (best): ${best_active_tip.height} (${best_active_tip.hash})\n`
			}

			for (let tip of other_tips)
				logString += `\t - ${tip.status}: Height ${tip.height} | Length ${tip.branchlen} (${tip.hash})\n`
		}

		// Write the logs for Peers
		if (!this.log_data.peers.completed && !peers_complete)
			logString += this.log_data.peers.main_spinner.frame() + "\n"
		else
			logString += `${logSymbols.success} ${this.log_data.peers.main_spinner.text} \n`

		// Write Log for Each Peer
		for (let peer_hash in this.log_data.peers){
			try {
				if (!this.log_data.peers[peer_hash].complete || this.log_data.peers[peer_hash].height < best_height)
					logString += `\t - ${this.log_data.peers[peer_hash].spinner.frame()}\n`
				else
					logString += `\t - ${logSymbols.success} ${this.log_data.peers[peer_hash].spinner.text}\n`
			} catch(e){}
		}

		// logString += JSON.stringify(this.getSyncStatus())

		return logString
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
	async getTarget() {
		return common.getTarget(await this.full_node.chain.getTarget(Date.now(), this.full_node.chain.tip))
	}
	getSyncStatus(){
		let best_height = 0
		for (let peer_hash in this.peers){
			if (this.peers[peer_hash].internal_peer.bestHeight > best_height)
				best_height = this.peers[peer_hash].internal_peer.bestHeight
		}

		if (best_height < this.full_node.chain.height)
			best_height = this.full_node.chain.height


		this.full_node_synced = this.full_node.chain.synced && (best_height !== 0 && this.full_node.chain.height >= best_height);
		this.sync_percent = this.full_node.chain.height / best_height

		return {
			synced: this.full_node_synced,
			sync_percent: this.sync_percent
		}
	}
}

export default ChainScanner
