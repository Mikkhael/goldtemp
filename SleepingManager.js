//@ts-check

class SleepingManager{
    constructor(){
        this.start_minutes = 0;
        this.duration_minutes = 0;
    }
    
    /**
     * 
     * @param {Number} start_minutes 
     * @param {Number} duration_minutes 
     */
    set_sleep_time(start_minutes, duration_minutes){
        this.start_minutes = start_minutes;
        this.duration_minutes = duration_minutes;
    }
    
    get_remaining_duration_ms(){
        const now = new Date();
        
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();
        
        const now_minutes = hour * 60 + minute;
        
        const offset_minutes = (now_minutes - this.start_minutes + 60*24) % (60*24);
        
        //console.log(hour, minute, now_minutes, offset_minutes, this.start_minutes, this.duration_minutes);
        if(offset_minutes < this.duration_minutes){
            return (this.duration_minutes - offset_minutes) * 1000 * 60;
        }else{
            return 0;
        }
    }
    
};


module.exports = SleepingManager;