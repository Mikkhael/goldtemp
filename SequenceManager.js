

class TransmissionSequence{
    constructor(/**@type {number} */number, /**@type {WebSocketWithSession} */ ws){
        this.number = number;
        this.time = Date.now();
        this.recipient = ws;
    }
}

class SequenceManager{
    constructor(){
        /**@type {Object.<number, TransmissionSequence>} */
        this.sequences = {};
        this.max_seq = 5000;
        this.max_timeout = 5 * 1000;
        this.last_seq_number = 0;
    }
    
    /**
     * @param {number} number 
     */
     check_if_free(number){
       if(!this.sequences[number]){
           return true;
       }
       if(Date.now() - this.sequences[number].time > this.max_timeout){
           console.log(`Seq Number ${number} expired (${this.sequences[number].time} | ${Date.now()})`);
           return true;
       }
       return false;
    }
    
    /**
     * @param {WebSocketWithSession} ws
     * @param {(number)=>void} next 
     */
    register_new(ws, next){
        let number = this.last_seq_number;
        let i=0;
        for(i=0; i<this.max_seq; i++){
            number = (number + i) % this.max_seq;
            if(this.check_if_free(number)){
                break;
            }
        }
        if(i == this.max_seq){
            setTimeout(this.register_new.bind(this, next), 1000);
            return;
        }
        this.sequences[number] = new TransmissionSequence(number, ws);
        this.last_seq_number = number + 1;
        next(number);
    }
    
    /**
     * @param {number} number 
     */
    release(number){
        const seq = this.sequences[number];
        if(seq){
            let ws = seq.recipient;
            delete this.sequences[number];
            return ws;
        }
        return null;
    }
}

module.exports = SequenceManager;