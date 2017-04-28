import { DBService } from '../services/db.service'
import { NetService } from '../services/net.service'
import { SamplesService } from '../services/samples.service'
import { SettingsService } from '../services/settings.service'
import { AI } from './ai';
import { AISquencer } from './aisequencer';
import { Metro } from './metro'
import { Mapper, MappedPlayer } from './mapper';
import { Instrument } from './instrument'
import { Pulse } from './pulse'
import { Player } from "./player"

import { MidiSequencer } from './midisequencer'
import { Savable } from './savable'
import { Generator } from './generator'
import { Thing } from './thing'


declare var firebase: any

export class Music extends Savable {

    playerType = "AI"
    playerTypes: Array<string> = ["AI", "midi"]
    things: Array<Thing> = []
    pulse: Pulse


    metro: Metro
    recording = false
    recordBuffer: Array<any> = []
    playHead = 0
    title = "A Song"

    constructor(private dbService: DBService, private samplesService: SamplesService,
    private netService: NetService, private monitor: any, public settings: SettingsService) {
        super()
        console.log("new music constructed")
        let self = this
        window.navigator["requestMIDIAccess"]().then(
            (midiAccess: any) => {
                midiAccess.inputs.forEach(function (midiInput: any) {
                    console.log(midiInput)
                    midiInput.onmidimessage = function (event: any) {
                        //  console.log(event.data)

                        if (self.recording && self.pulse.running) {
                            let stamp = self.pulse.getBeatNow()
                            self.recordBuffer.push([stamp, event.data])
                        }

                        self.things.forEach((p) => {
                            if (p instanceof Player) {
                                if (p.recording) p.inst.playEvent(event.data, 0)
                            }
                        })

                    }
                })
            })

        this.setID(0)
        this.constructorX()
    }


    saveDB(saver: any): any {
        if (this.isSaved()) return
        let itemIDs: Array<any> = []

        let playerPos = 0
        let postItems: any = {
        }



        this.things.forEach((p: Player) => {
            let itemID: string = p.saveDB(saver)
            if (itemID !== null) {
                postItems[itemID] = playerPos++
            }
        })

        this.setID(saver.newIDItem('songs', postItems))

        postItems = {
            title: this.title,
        }

        saver.newIDItem('songinfo/' + saver.user.uid, postItems, this.id)

    }

    loadPlayer(playerSnap: any, pos: number) {

        let instName: string
        switch (playerSnap.child("type").val()) {

            case "MidiSequencer":
                instName = playerSnap.child("inst").val()
                let midiPlayer = this.addMidiPlayer(instName, pos)
                midiPlayer.setID(playerSnap.key)
                let midiKey = playerSnap.child("midi").val()
                if (midiKey !== null) {
                    let midiRef = firebase.database().ref("midi").child(midiKey);
                    midiRef.once("value").then((midi: any) => {
                        let midiData: any = JSON.parse(midi.val())
                        let seq: MidiSequencer = <MidiSequencer>midiPlayer.ticker
                        seq.setBuffer(midiData, midiKey)
                    })
                }
                break


            case "AISequencer":
                instName = playerSnap.child("inst").val()
                let aiKey = playerSnap.child("ai").val()
                let aiRef = firebase.database().ref("ai").child(aiKey);
                aiRef.once("value").then((aiSnap: any) => {

                    let netKey = aiSnap.child("net").val()
                    let netRef = firebase.database().ref("net").child(netKey)
                    netRef.once("value").then((netSnap: any) => {
                        let netInfo = netSnap.val()
                        this.addAIPlayer(instName, netInfo, pos)
                    })
                })
                break;


            case "Pulse":
                this.pulse.loadSnap(playerSnap)

                break
            default:
                console.log("UNKOWN TYPE : " + playerSnap.child("type").val())
        }

    }

    loadDB(songref: any) {
        songref.once("value").then((song: any) => {
            song.forEach((player: any) => {

                let playerref = firebase.database().ref("players").child(player.key);
                playerref.once("value").then((playerSnap: any) => {
                    this.loadPlayer(playerSnap, player.val())

                })
            })
        })
    }

    constructorX() {

        let ticksPerBeat = 12
        let bpm = 120

        this.pulse = new Pulse(ticksPerBeat, bpm, this.settings)
        this.things.push(this.pulse)

        // let majorSeed = [0, 2, 4, 5, 7, 9, 11]
        // let stack3 = [0, 2, 4, 6, 8, 10, 12]

        this.metro = new Metro(this.pulse, this.samplesService, this.monitor)

    }


    addMidiPlayer(name: string, pos: any): Player {
        let player = new Player(this)
        if (pos === null || pos === true ) this.things.push(player)
        else this.things[pos] = player
        let inst = new Instrument(name, this.monitor)
        player.inst = inst
        let midiPlayer = new MidiSequencer(player)
        player.ticker = midiPlayer
        this.change()
        return player
    }



    addAIPlayer(instName: string, net: any, pos: number): Player {

        if (!net) net = {}

        if (net.nOut === undefined) net.nOut = 20
        if (net.nHidden === undefined) net.nHidden = [20]
        if (net.nIn === undefined) net.nIn = this.pulse.rampers.length

        let player = new Player(this)

        if (pos === null) this.things.push(player)
        else this.things[pos] = player

        let ai = new AI(this.dbService, this.netService)

        player.ai = ai


        if (instName === undefined) instName = "marimba"
        player.name = instName

        let inst = new Instrument(instName, this.monitor)
        player.inst = inst


        if (net.seed === undefined) {
            net.seed = Math.random()
        }
        let generator = new Generator(net.seed)

        ai.init(this.pulse, net)

        let base: Array<number> = [0, 3, 5, 7, 10]

        let mapper = new Mapper(40, base)
        player.mapper = mapper

        let mapPlayer = new MappedPlayer(inst, mapper)

        let playerAI = new AISquencer(ai, mapPlayer, this.pulse)
        player.ticker = playerAI
        this.change()   //  TODO not if we are loading
        return player

    }

    removePlayer(player: Player) {

        this.pulse.removeClient(player)
        let index = 0
        for (let i = 0; index < this.things.length; index++) {
            if (this.things[index] === player) {
                this.things.splice(index, 1);
                this.change()
                if (this.things.length === 0) this.setID(0)
                return;
            }
        }

    }

    tick(): void {

        try {
            this.pulse.tick()
        } catch (err) {
            console.log(err.stack)
        }

        this.playHead = this.pulse.beat
    }

    record(yes: boolean) {
        this.recording = yes
    }

    start() {
        this.pulse.start()
    }

    stop() {
        this.pulse.stop()
        if (this.recordBuffer.length > 0) {
            this.things.forEach((p) => {
                if (p instanceof Player) {
                    if (p.recording && (p.ticker instanceof MidiSequencer)) {
                        p.ticker.setBuffer(this.recordBuffer, null)
                        p.change()
                    }
                }
            })
        }
        this.recordBuffer = []
    }

    pause() {
        this.pulse.pause()
    }

    isRunning(): boolean {
        return this.pulse.running
    }

    /*
     setPlayerType(t:string) {
         this.playerType=t
     }

     /*
     window.navigator.requestMIDIAccess().then(function(midiAccess) {
         midiAccess.inputs.forEach(function(midiInput) {
             self.focusPlayer.listenToMidi(midiInput)
         });
     });
     */

}
