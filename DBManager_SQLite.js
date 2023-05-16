//@ts-check
const sqlite = require('sqlite3');

const DB_CRED = require('./db_credentials');

const table_name = process.env['DEBUG_MODE'] == '1' ? "measurements_test" : "measurements";
const config_table_name = process.env['DEBUG_MODE'] == '1' ? "config_test" : "config";

const setup_query = `
CREATE TABLE IF NOT EXISTS \`measurements\` (
    \`id\` integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    \`thermometer_id\` text NOT NULL,
    \`time\` datetime NOT NULL,
    \`value\` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS \`names\` (
    \`thermometer_id\` text NOT NULL PRIMARY KEY,
    \`thermometer_name\` text NOT NULL
);
`;

class DBManager{
    constructor(){
        this.filepath = DB_CRED.FILE;
        this.connection = null;
    }

    setup(next = function(err){}){
        //@ts-ignore
        this.connection?.exec(setup_query, function(err){
            if(err){
                console.error("Error while creating a database: ", err);
            }
            next(err);
        });
    }

    connect(connection_params = {}, next = function(err){}){
        this.#_connect_impl(next);
    }
    #_connect_impl(next = function(err){}){
        if(this.connection){ this.connection.close(); this.connection = null; };
        this.connection = new sqlite.Database(this.filepath, (err) => {
            if(err){
                console.error('Error while connecting to MySQL server: ', err);
                next(err);
            }else{
                this.setup(next);
            }
            console.log("SQLite Connected.");
        });
    }
    reconnect(next = function(err){}){
        if(!this.is_connected()){
            this.#_connect_impl(next);
        }
    }
    is_connected(){
        return this.connection !== null;
    }
    assure_connected(nextErr, nextGood){
        if(this.is_connected()){
            return true;
        }
        this.connect({}, function(err){
            if(err){
                nextErr(err);
            }else{
                nextGood();
            }
        });
        return false;
    }
    disconnect(next = function(err){}){
      this.connection.close((err) => {
        if(err){
          console.log("Error closing the database: ", err);
        }
        this.connection = null;
        console.log("Disconnected SQLite.");
        next(err);
      });
    }
    
    /**
     * 
     * @param {Date[]} times 
     * @param {BigInt[]} thermometers_ids 
     * @param {number[]} values 
     */
    insert_new_measurements(times, thermometers_ids, values, next = function(err){}){
        if(!this.assure_connected(next, this.insert_new_measurements.bind(this, ...arguments))){
            return;
        }
        const NO_VALUE = -200*128;
        let query = `INSERT INTO ${table_name} (time, thermometer_id, value) VALUES `;
        for(let time_i=0; time_i<times.length; time_i++){
            const time = times[time_i];
            for (let i = 0; i < thermometers_ids.length; i++) {
                const thermometer_id = thermometers_ids[i].toString();
                const value = values[time_i*thermometers_ids.length + i];
                if(value === NO_VALUE){
                    continue;
                }
                query += `("${time.toISOString()}","${thermometer_id}",${value}),`;
            }
        }
        query = query.slice(0,-1);
        //@ts-ignore
        this.connection.run(query,(err) => {
            if(err){
                console.error("Error while perofming insert query: ", err);
            }
            next(err);
        });
    }
    
    get_last_measurements(next = function(err, rows){}){
        if(!this.assure_connected(next, this.get_last_measurements.bind(this, ...arguments))){
            return;
        }
        const query =
        `SELECT m.thermometer_id as id, m.time, MAX(m.value) as value FROM ${table_name} AS m JOIN(
         SELECT MAX(m.time) AS time, m.thermometer_id AS id FROM ${table_name} AS m GROUP BY m.thermometer_id
         ) AS maxes ON m.thermometer_id = maxes.id AND m.time = maxes.time GROUP BY m.thermometer_id, m.time`;
        //@ts-ignore
        this.connection.all(query, (err, rows)=>{
            if(err){
                console.error("Error while performing get_last_measurements query: ", err);
                next(err);
                return;
            }
            //@ts-ignore
            this.connection.run(`DELETE FROM measurements WHERE (julianday(datetime('now', '-${DB_CRED.PAST} days')) > julianday(time))`, (err) => {
                if(err){
                    console.error("Error while performing deletion: ", err);
                    next(err);
                    return;
                }
                //@ts-ignore
                this.connection.run(`DELETE FROM \`measurements\` WHERE (julianday(datetime('now')) < julianday(time));`, (err) => {
                    if(err){
                        console.error("Error while performing deletion of newer: ", err);
                    }
                    next(err, rows);
                    return;
                });
            });

        });
    }
    
    get_thermometers_names(next = function(err, rows){} ){
        if(!this.assure_connected(next, this.get_thermometers_names.bind(this, ...arguments))){
            return;
        }
        const query = `SELECT * FROM names`;
        //@ts-ignore
        this.connection.all(query, function(err, rows){
            if(err){
                console.error("Error while performing get_thermometers_names query: ", err);
                next(err);
                return;
            }
            next(err, rows);
        });
    }

    /**
     * @param {BigInt} id 
     * @param {BigInt} from
     * @param {BigInt} to
     */
    get_measurements_since(id, from, to, next = function(err, rows){} ){
        if(!this.assure_connected(next, this.get_measurements_since.bind(this, ...arguments))){
            return;
        }
        const query = `SELECT value, UNIX_TIMESTAMP(time) as time FROM ${table_name} WHERE thermometer_id=${id.toString()} AND UNIX_TIMESTAMP(time) BETWEEN ${from} AND ${to}`;
        //@ts-ignore
        this.connection.all(query, function(err, rows){
            if(err){
                console.error("Error while performing get_measurements_since query: ", err);
                next(err);
                return;
            }
            next(err, rows);
        });
    }
    
};

module.exports = DBManager;