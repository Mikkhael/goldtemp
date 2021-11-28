//@ts-check
const mysql = require('mysql2');

const DB_CRED = require('./db_credentials');

const table_name = process.env['DEBUG_MODE'] == '1' ? "measurements_test" : "measurements";
const config_table_name = process.env['DEBUG_MODE'] == '1' ? "config_test" : "config";

class DBManager{
    constructor(){
        this.default_connection_params = {
            database: DB_CRED.NAME,
            port: +DB_CRED.PORT,
            host: DB_CRED.ADDR,
            user: DB_CRED.USER,
            supportBigNumbers: true,
        };
        
        if(DB_CRED.PASS){
            this.default_connection_params.password = DB_CRED.PASS;
        }
        this.connection = null;
        this.last_connection_params = Object.assign({}, this.default_connection_params);
    }
    connect(connection_params = {}, next = function(err){}){
        this.last_connection_params = Object.assign({}, this.default_connection_params, connection_params);
        this.#_connect_impl(next);
    }
    #_connect_impl(next = function(err){}){
        this.connection = mysql.createConnection(this.last_connection_params);
        this.connection.connect(function (err){
            if(err){
                console.error('Error while connecting to MySQL server: ', err);
            }
            next(err);
        });
    }
    reconnect(next = function(err){}){
        if(!this.is_connected()){
            this.#_connect_impl(next);
        }
    }
    is_connected(){
        return this.connection && this.connection.authorized && this.connection;
    }
    
    // #_reconnect_if_nessesary(next_error, next_good){
    //     if(!this.is_connected()){
    //         console.log("Connection disconnected. Reconnecting...");
    //         this.reconnect(function(err){
    //             if(err){
    //                 next_error(err);
    //                 return;
    //             }
    //             next_good();
    //         });
    //         return;
    //     }
    // }
    
    /**
     * 
     * @param {string} query 
     * @param {function(mysql.QueryError, mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.OkPacket | mysql.OkPacket[] | mysql.ResultSetHeader, mysql.FieldPacket[]) : void} callback 
     */
    query_with_reconnect(query, callback = function(err, result, fields){}){
        this.connection.query(query, (err, ...rest) => {
            if(err && err.fatal){
                this.#_connect_impl((err2) => {
                    if(err2){
                        callback(err, ...rest);
                        return;
                    }
                    this.connection.query(query, callback);
                });
                return;
            }
            callback(err, ...rest);
        })
    }
    
    /**
     * 
     * @param {Date[]} times 
     * @param {BigInt[]} thermometers_ids 
     * @param {number[]} values 
     */
    insert_new_measurements(times, thermometers_ids, values, next = function(err){}){
        //this.#_reconnect_if_nessesary(next, this.insert_new_measurements.bind(this, ...arguments));
        const NO_VALUE = -200;
        let query = `INSERT INTO ${table_name} (time, thermometer_id, value) VALUES `;
        for(let time_i=0; time_i<times.length; time_i++){
            const time = times[time_i];
            for (let i = 0; i < thermometers_ids.length; i++) {
                const thermometer_id = thermometers_ids[i];
                const value = values[time_i*thermometers_ids.length + i];
                if(value === NO_VALUE){
                    continue;
                }
                query += `(${mysql.escape(time)},${thermometer_id},${value}),`;
            }
        }
        query = query.slice(0,-1);
        this.query_with_reconnect(query,(err) => {
            if(err){
                console.error("Error while perofming insert query: ", err);
            }
            next(err);
        });
    }
    
    get_last_measurements(next = function(err, result){}){
        //this.#_reconnect_if_nessesary(next, this.get_last_measurements.bind(this, ...arguments));
        const query =
        `SELECT m.thermometer_id as id, m.time, MAX(m.value) as value FROM ${table_name} AS m JOIN(
         SELECT MAX(m.time) AS time, m.thermometer_id AS id FROM ${table_name} AS m GROUP BY m.thermometer_id
         ) AS maxes ON m.thermometer_id = maxes.id AND m.time = maxes.time GROUP BY m.thermometer_id, m.time`;
        this.query_with_reconnect(query, function(err, result, fields){
            if(err){
                console.error("Error while performing get_last_measurements query: ", err);
                next(err);
            }
            next(err, result);
        });
    }
    
    get_sleep_config(next = function(err, result){}){
        //this.#_reconnect_if_nessesary(next, this.get_sleep_config.bind(this, ...arguments));
        const query = `SELECT sleep_start_minutes, sleep_duration_minutes FROM ${config_table_name} LIMIT 1`;
        
        this.query_with_reconnect(query, function(err, result, fields){
            if(err){
                console.error("Error while performing get_sleep_config query: ", err);
                next(err);
            }
            next(err, result);
        });
    }
    
    set_sleep_config(sleep_start_minutes, sleep_duration_minutes, next = function(err, result){}){
        const query = `UPDATE ${config_table_name} SET sleep_start_minutes=${sleep_start_minutes}, sleep_duration_minutes=${sleep_duration_minutes} WHERE 1`;
        this.query_with_reconnect(query, function(err, result, fields){
            if(err){
                console.error("Error while performing set_sleep_config query: ", err);
                next(err);
            }
            next(err, result);
        });
    }
    
};

module.exports = DBManager;