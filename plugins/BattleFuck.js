var fChatLibInstance;
var channel;
var redis = require("redis");
var client = redis.createClient({port: 6379, host: "127.0.0.1", db: 1});
var currentFighters = [];
var currentFight = {defender: 2, bypassTurn: false, turn: -1, whoseturn: -1, isInit: false, orgasms: 0, winner: -1, currentHold: {}, actionTier: "", actionType: "", dmgHp: 0, dmgLust: 0, actionIsHold: false, diceResult: 0, intMovesCount: [0,0]};
var cappudice = require('cappu-dice');
var dice = new cappudice(100);
var maxHp = 8;

module.exports = function (parent, chanName) {
    fChatLibInstance = parent;

    var cmdHandler = {};
    channel = chanName;

    client.on("error", function (err) {
        console.log("Redis error " + err);
    });

    cmdHandler.hp = function () {
        broadcastCombatInfo();
    };
    cmdHandler.stamina = cmdHandler.hp;
    cmdHandler.status = cmdHandler.stamina;
    cmdHandler.current = cmdHandler.status;

    cmdHandler.setFight = function(args,data){ //debug
        if (fChatLibInstance.isUserChatOP(data.character, channel)) {
            if(!checkIfFightIsGoingOn()){
                fChatLibInstance.sendMessage("There isn't a fight going on right now.", channel);
                return;
            }
            var arr = args.split(' ');
            var result = arr.splice(0, 2);
            result.push(arr.join(' ')); //split the string (with 3 arguments) only in 3 parts (stat, number, character)

            if (result.length == 3 && result[0] != "" && !isNaN(result[1]) && !isNaN(result[2])) {
                currentFighters[result[2]][result[0]] = parseInt(result[1]);
                fChatLibInstance.sendMessage("Succesfully set the "+result[0]+" to "+parseInt(result[1]) + " for the current fight.", channel);
            }
            else {
                fChatLibInstance.sendMessage("Invalid syntax. Correct is: !setFight stat amount turn_number. Example: !setFight lust 10 0", channel);
            }
        }
        else{
            fChatLibInstance.sendMessage("You don't have sufficient rights.", channel);
        }
    };

    cmdHandler.set = function(args,data){ //debug
        if (fChatLibInstance.isUserChatOP(channel, data.character)) {
            var arr = args.split(' ');
            var result = arr.splice(0, 2);
            result.push(arr.join(' ')); //split the string (with 3 arguments) only in 3 parts (stat, number, character)

            if (result.length == 3 && result[0] != "" && !isNaN(result[1]) && result[2] != "") {
                client.hgetall(result[2], function (err, char) {
                    if (char != null) {
                        char[result[0]] = parseInt(result[1]);
                        client.hmset(char.character, char);
                        fChatLibInstance.sendMessage("Succesfully set the "+result[0]+" to "+parseInt(result[1]), channel);
                    }
                    else {
                        fChatLibInstance.sendMessage("Are you sure this user is registered?", channel);
                    }
                });
            }
            else {
                fChatLibInstance.sendMessage("Invalid syntax. Correct is: !set stat amount CHARACTER. Example: !set xp 10 ThatCharacter", channel);
            }
        }
        else{
            fChatLibInstance.sendMessage("You don't have sufficient rights.", channel);
        }
    };

    cmdHandler.exit = function (args, data) {
        if (currentFighters.length > 0) {
            if ((currentFighters.length > 0 && currentFighters[0] != undefined && currentFighters[0].character == data.character) || (currentFighters.length > 1 && currentFighters[1] != undefined && currentFighters[1].character == data.character)) {
                fChatLibInstance.sendMessage("The fight has been ended.", channel);
                if(currentFighters.length > 1){
                    addExperienceOnPrematureEnd(currentFighters[0].character, currentFight.intMovesCount[0], currentFighters[1].character, currentFight.intMovesCount[1]);
                }
                setTimeout(resetFight(),2500);
            }
            else {
                fChatLibInstance.sendMessage("You are not in a fight.", channel);
            }
        }
        else {
            fChatLibInstance.sendMessage("There isn't any fight going on at the moment.", channel);
        }
    };
    cmdHandler.leave = cmdHandler.exit;
    cmdHandler.leaveFight = cmdHandler.exit;
    cmdHandler.forfeit = cmdHandler.exit;
    cmdHandler.unready = cmdHandler.exit;

    cmdHandler.deleteProfile = function (args, data) {
        if (fChatLibInstance.isUserChatOP(channel, data.character)) {
            if (checkIfFightIsGoingOn()) {
                if (currentFighters[0].character == data.character || currentFighters[1].character == data.character) {
                    fChatLibInstance.sendMessage("You can't add remove this profile if it's in a fight.", channel);
                    return;
                }
            }
            client.del(args, function (err, result) {
                if (result == 1) {
                    fChatLibInstance.sendMessage(args + "'s stats have been deleted. Thank you for playing!", channel);
                }
                else {
                    fChatLibInstance.sendMessage("This profile hasn't been found in the database.", channel);
                }
            });
        }
        else {
            fChatLibInstance.sendMessage("You don't have sufficient rights.", channel);
        }
    };

    var statsGetter = function(args, data, character){
        client.hgetall(character, function (err, result) {
            if (result != null) {
                var stats = result; //Health is (Toughness x 5) while Stamina is (Endurance x 5)
                var wins, losses;
                if(isNaN(stats.wins)){
                    wins = 0;
                }
                else{
                    wins = stats.wins;
                }
                if(isNaN(stats.losses)){
                    losses = 0;
                }
                else{
                    losses = stats.losses;
                }
                if(result.history == undefined){
                    result.history = "";
                }
                fChatLibInstance.sendMessage("[b]" + data.character + "[/b]'s stats" + "\n" +
                    "[b][color=green]Win[/color]/[color=red]Loss[/color] record[/b]: " + wins + " - " + losses + "\n" +
                    "Last match: "+result.history, channel);
            }
            else {
                fChatLibInstance.sendPrivMessage(data.character, "You aren't registered yet.");
            }
        });
    };

    cmdHandler.crash = function (args, data) {
        args.push("ewf");
    };

    cmdHandler.myStats = function (args, data) {
        statsGetter(args, data, data.character);
    };
    cmdHandler.stats = cmdHandler.myStats;

    cmdHandler.getStats = function (args, data) {
        statsGetter(args, data, args);
    };

    cmdHandler.forceTurnWin = function(args,data){ //debug
        if (fChatLibInstance.isUserChatOP(channel, data.character)) {
            currentFighters[currentFight.whoseturn].dice.addTmpMod(100,1);
        }
    };

    cmdHandler.forceTurnLose = function(args,data){ //debug
        if (fChatLibInstance.isUserChatOP(channel, data.character)) {
            currentFighters[currentFight.whoseturn].dice.addTmpMod(-100,1);
        }
    };

    cmdHandler.reset = function (args, data) {
        if (fChatLibInstance.isUserChatOP(channel, data.character)) {
            if (checkIfFightIsGoingOn()) {
                resetFight();
                fChatLibInstance.sendMessage("The ring has been cleared.", channel);
            }
            else {
                fChatLibInstance.sendMessage("The ring isn't occupied.", channel);
            }
        }
        else {
            fChatLibInstance.sendMessage("You don't have sufficient rights.", channel);
        }
    };

    cmdHandler.ready = function (args, data) {
        if (currentFighters.length == 0) {
            currentFighters[0] = [];
            currentFighters[0].character = data.character;
            currentFighters[0].odds = 50;
            currentFighters[0].hp = maxHp;
            currentFighters[0].locked = false;
            currentFighters[0].headTied = false;
            currentFighters[0].armsTied = false;
            currentFighters[0].legsTied = false;
            fChatLibInstance.sendMessage(data.character + " is the first one to step in the ring, ready to fight! Who will be the lucky opponent?", channel);
        }
        else if (currentFighters.length == 1) {
            if (currentFighters[0].character != data.character) {
                currentFighters[1] = [];
                currentFighters[1].character = data.character;
                currentFighters[1].odds = 50;
                currentFighters[1].hp = maxHp;
                currentFighters[1].locked = false;
                currentFighters[1].headTied = false;
                currentFighters[1].armsTied = false;
                currentFighters[1].legsTied = false;
                fChatLibInstance.sendMessage(data.character + " accepts the challenge! Let's get it on!", channel);
                beginInitiation();
            }
            else {
                fChatLibInstance.sendMessage("You can't set yourself ready twice!", channel);
            }
        }
        else {
            fChatLibInstance.sendMessage("Sorry, our two wrestlers are still in the fight!", channel);
        }
    };

    cmdHandler.pass = function (args, data) {
        if (checkIfFightIsGoingOn()) {
            if (data.character == currentFighters[currentFight.whoseturn].character) {
                currentFight.actionType = "pass";
                currentFight.actionTier = "";
                checkRollWinner(true);
            }
            else {
                fChatLibInstance.sendMessage("It's not your turn yet.", channel);
            }

        }
        else {
            fChatLibInstance.sendMessage("There isn't a match going on at the moment.", channel);
        }
    };
    cmdHandler.skip = cmdHandler.pass;

    cmdHandler.escape = function (args, data) {
        if (checkIfFightIsGoingOn()) {
            if (data.character == currentFighters[currentFight.whoseturn].character) {
                currentFight.actionType = "";
                currentFight.defender = currentFight.whoseturn;
                switch(args.toLowerCase()){
                    case "head":
                    case "face":
                    case "hair":
                        if(currentFighters[currentFight.whoseturn].headTied){
                            currentFight.actionType = "escapeHigh";
                        }
                        break;
                    case "arms":
                    case "hands":
                    case "wrists":
                        if(currentFighters[currentFight.whoseturn].armsTied) {
                            currentFight.actionType = "escapeMedium";
                        }
                        break;
                    case "legs":
                    case "thighs":
                    case "feet":
                        if(currentFighters[currentFight.whoseturn].legsTied) {
                            currentFight.actionType = "escapeLow";
                        }
                        break;
                    default:
                        break;
                }

                if(currentFight.actionType == ""){
                    fChatLibInstance.sendMessage("Invalid argument for this command. It should be: Head/Face/Hair OR Arms/Hands/Wrists OR Legs/Thighs/Feet and you must be tied up there! Example: !tie wrists", channel);
                    return;
                }
                if (currentFight.turn > 0) {
                    rollBoth();
                }
            }
            else {
                fChatLibInstance.sendMessage("It's not your turn to attack.", channel);
            }

        }
        else {
            fChatLibInstance.sendMessage("There isn't a match going on at the moment.", channel);
        }
    };

    cmdHandler.giveUp = function (args, data) {
        if (checkIfFightIsGoingOn()) {
            if (data.character == currentFighters[currentFight.whoseturn].character) {
                if (currentFighters[currentFight.whoseturn].headTied && currentFighters[currentFight.whoseturn].armsTied && currentFighters[currentFight.whoseturn].legsTied) {
                    if (currentFight.turn > 0) {
                        currentFight.winner = (currentFight.whoseturn == 0 ? 1 : 0);
                        fChatLibInstance.sendMessage(currentFighters[currentFight.whoseturn].character + " is giving up! It must have been too much to handle!", channel);
                        checkLifePoints();
                    }
                }
                else {
                    fChatLibInstance.sendMessage("You're not fully bound, you can't give up yet!", channel);
                }
            }
            else {
                fChatLibInstance.sendMessage("It's not your turn to attack.", channel);
            }

        }
        else {
            fChatLibInstance.sendMessage("There isn't a match going on at the moment.", channel);
        }
    };
    cmdHandler.tapout = cmdHandler.giveUp;
    cmdHandler.surrender = cmdHandler.giveUp;
    cmdHandler.submit = cmdHandler.giveUp;


    cmdHandler.tie = function(args,data){
        if (args.length > 0) {
            if (checkIfFightIsGoingOn()) {
                if (data.character == currentFighters[currentFight.whoseturn].character) {
                    if (currentFighters[currentFight.whoseturn].locked) {
                        fChatLibInstance.sendMessage("You are still locked up. You can either !escape hands or !tapout and lose if you're fully restrained.", channel);
                        return;
                    }

                    currentFight.actionType = "";
                    switch(args.toLowerCase()){
                        case "head":
                        case "face":
                        case "hair":
                            currentFight.actionType = "tieHigh";
                            break;
                        case "arms":
                        case "hands":
                        case "wrists":
                            currentFight.actionType = "tieMedium";
                            break;
                        case "legs":
                        case "thighs":
                        case "feet":
                            currentFight.actionType = "tieLow";
                            break;
                        default:
                            break;
                    }

                    if(currentFight.actionType == ""){
                        fChatLibInstance.sendMessage("Invalid argument for this command. It should be: Head/Face/Hair OR Arms/Hands/Wrists OR Legs/Thighs/Feet. Example: !tie wrists", channel);
                        return;
                    }
                    if (currentFight.turn > 0) {
                        roll();
                    }
                }
                else if (data.character == currentFighters[(currentFight.whoseturn == 0 ? 1 : 0)].character) {
                    fChatLibInstance.sendMessage("It's not your turn to attack.", channel);
                }
                else {
                    fChatLibInstance.sendMessage("You're not in the fight.", channel);
                }

            }
        }
        else {
            //available commands
            fChatLibInstance.sendMessage("This command requires one argument. Check the page for more information. Example: !brawl light OR !sexual medium OR !hmove Heavy OR !bondage item", channel);
        }
    };


    cmdHandler.attack = function(args,data){
        if (checkIfFightIsGoingOn()) {
            if (data.character == currentFighters[currentFight.whoseturn].character) {
                if (currentFighters[currentFight.whoseturn].locked) {
                    fChatLibInstance.sendMessage("You are still locked up. You can either !escape hands or !tapout and lose if you're fully restrained.", channel);
                    return;
                }

                currentFight.actionType = "sex";
                if (currentFight.turn > 0) {
                    roll();
                }
            }
            else if (data.character == currentFighters[(currentFight.whoseturn == 0 ? 1 : 0)].character) {
                fChatLibInstance.sendMessage("It's not your turn to attack.", channel);
            }
            else {
                fChatLibInstance.sendMessage("You're not in the fight.", channel);
            }

        }
    };
    cmdHandler.sexyattack = cmdHandler.attack;
    cmdHandler.stroke = cmdHandler.attack;
    cmdHandler.fuck = cmdHandler.attack;
    cmdHandler.lick = cmdHandler.attack;

    return cmdHandler;
};

function beginInitiation(){
    currentFight = {turn: -1, whoseturn: -1, isInit: false, orgasms: 0, winner: -1, currentHold: {}, actionTier: "", actionType: "", dmgHp: 0, dmgLust: 0, actionIsHold: false, diceResult: 0, intMovesCount: [0,0]};
    currentFight.turn = 0;
    currentFight.isInit = true;
    currentFight.bothPlayerRoll = true;
    fChatLibInstance.sendMessage("\n[b]Let's start![/b]\n\n[b]" + currentFighters[0].character + "[/b]\n\n[color=red]VS[/color]\n\n[b]" + currentFighters[1].character + "[/b]", channel);
    rollBoth();
}

function rollBoth(){
    currentFight.bothPlayerRoll = true;
    currentFight.diceResultP1 = dice.roll();
    currentFight.diceResultP2 = dice.roll();
    fChatLibInstance.sendMessage("\n[b]" + currentFighters[0].character + "[/b] rolled a [b]" + currentFight.diceResultP1  + "[/b]\n" +
        "[b]" + currentFighters[1].character + "[/b] rolled a [b]" + currentFight.diceResultP2 + "[/b] ", channel);
    checkRollWinner();
}

function roll() {
    if(currentFight.bypassTurn){
        checkRollWinner(true);
    }
    else{
        currentFight.diceResult = dice.roll();
        fChatLibInstance.sendMessage("\n[b]" + currentFighters[currentFight.whoseturn].character + "[/b] rolled a [b]" + currentFight.diceResult + "[/b]", channel);
        checkRollWinner();
    }

}

function checkRollWinner(blnForceSuccess) {
    if(currentFight.bothPlayerRoll){
        currentFight.bothPlayerRoll = false;
        if(currentFight.diceResultP1 == currentFight.diceResultP2){
            rollBoth();
            return;
        }
        var idWinner = (currentFight.diceResultP1 > currentFight.diceResultP2 ? 0 : 1);
        if (currentFight.isInit) {
            currentFight.isInit = false;
            fChatLibInstance.sendMessage("[i]" + currentFighters[idWinner].character + " emotes the attack first.[/i]", channel);
            currentFight.whoseturn = idWinner;
            nextTurn(false);
        }
        else{
            currentFight.diceResult = -1;
            checkRollWinner((idWinner == currentFight.defender));
        }
    }
    else{
        var success = false;

        //check for success
        if(currentFight.diceResult >= (100 - parseInt(currentFighters[currentFight.whoseturn].odds))){
            success = true;
        }

        //bypass the former check
        if(blnForceSuccess){
            success = blnForceSuccess;
            currentFight.bypassTurn = false;
        }

        //attack process
        if (success) {
            if (currentFight.actionType == "pass") {
                fChatLibInstance.sendMessage(currentFighters[currentFight.whoseturn].character + " has passed this turn.", channel);
            }
            else if(currentFight.actionType == "escapeHigh"){
                fChatLibInstance.sendMessage("You tried to get out and... all the restraints on your head [b]finally[/b] gave in! [i]It's still your turn![/i]", channel);
                currentFighters[currentFight.whoseturn].headTied = false;
                currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds += 15;
                currentFighters[currentFight.whoseturn].odds -= 15;
                return;
            }
            else if(currentFight.actionType == "escapeMedium"){
                fChatLibInstance.sendMessage("You tried to get out and... all the restraints on your arms and hands [b]finally[/b] gave in! [i]It's still your turn![/i]", channel);
                currentFighters[currentFight.whoseturn].armsTied = false;
                currentFighters[currentFight.whoseturn].locked = false;
                currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds += 10;
                currentFighters[currentFight.whoseturn].odds -= 10;
                return;
            }
            else if(currentFight.actionType == "escapeLow"){
                fChatLibInstance.sendMessage("You tried to get out and... all the restraints on your legs and thighs [b]finally[/b] gave in! [i]It's still your turn![/i]", channel);
                currentFighters[currentFight.whoseturn].legsTied = false;
                currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds += 15;
                currentFighters[currentFight.whoseturn].odds -= 15;
                return;
            }
            else if(currentFighters[currentFight.whoseturn].locked == true){
                currentFight.bypassTurn = true;
                fChatLibInstance.sendMessage("You can't do that if you're locked! Your roll has ben saved.", channel);
                return;
            }
            else if( currentFight.actionType == "tieHigh"){
                if(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].headTied){
                    fChatLibInstance.sendMessage(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character + "'s head looks even worse now! -5 to "+currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character+"'s odds, and +5 to "+currentFighters[currentFight.whoseturn].character+"'s!", channel);
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds -= 5;
                    currentFighters[currentFight.whoseturn].odds += 5;
                }
                else{
                    fChatLibInstance.sendMessage(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character + "'s head doesn't look that good! -15 to "+currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character+"'s odds, and +15 to "+currentFighters[currentFight.whoseturn].character+"'s!", channel);
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds -= 15;
                    currentFighters[currentFight.whoseturn].odds += 15;
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].headTied = true;
                }

            }
            else if( currentFight.actionType == "tieMedium"){
                if(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].armsTied){
                    fChatLibInstance.sendMessage(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character + " surely can't even move their arms! They're still [color=red][b]locked up[/b][/color] and got a -5 penalty to their odds, while "+currentFighters[currentFight.whoseturn].character+" gets +5 to theirs!", channel);
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds -= 5;
                    currentFighters[currentFight.whoseturn].odds += 5;
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].locked = true;
                }
                else{
                    fChatLibInstance.sendMessage(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character + " is not going to do anything with their arms tied like that! They're now [color=red][b]locked up[/b][/color] and got a -10 penalty to their odds, while "+currentFighters[currentFight.whoseturn].character+" gets +10 to theirs!", channel);
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds -= 10;
                    currentFighters[currentFight.whoseturn].odds += 10;
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].locked = true;
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].armsTied = true;
                }
            }
            else if( currentFight.actionType == "tieLow"){
                if(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].headTied){
                    fChatLibInstance.sendMessage(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character + " is definitely not going to move after that! -5 penalty to their odds, while "+currentFighters[currentFight.whoseturn].character+" gets +5 to theirs!", channel);
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds -= 5;
                    currentFighters[currentFight.whoseturn].odds += 5;
                }
                else{
                    fChatLibInstance.sendMessage(currentFighters[(currentFight.whoseturn == 0 ? 1:0)].character + "'s not going to be running from now on! -15 penalty to their odds, while "+currentFighters[currentFight.whoseturn].character+" gets +15 to theirs!", channel);
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].odds -= 15;
                    currentFighters[currentFight.whoseturn].odds += 15;
                    currentFighters[(currentFight.whoseturn == 0 ? 1:0)].legsTied = true;
                }
            }
            else {
                fChatLibInstance.sendMessage("[b]" + currentFighters[currentFight.whoseturn].character + "'s sexy attack has [color=green][u]hit![/u][/color][/b]", channel);
                attackHandler(1);
            }
        }
        else{
            //fail handler
            fChatLibInstance.sendMessage("[b]" + currentFighters[currentFight.whoseturn].character + "'s attack [color=red][u]missed...[/u][/color][/b]", channel);
        }
        if (currentFight.winner != -1) { // FIGHT GETS RESETED BEFORE ANYTHING
            return;
        }
        nextTurn();
    }

}

function attackHandler(damageHP, attacker, defender) {
    var hpRemoved = -1;

    if (attacker == undefined) {
        attacker = currentFight.whoseturn;
    }
    if (defender == undefined) {
        defender = (currentFight.whoseturn == 0 ? 1 : 0);
    }

    var strAttack = "[b]" + currentFighters[attacker].character + "[/b] has";

    if (damageHP != undefined && damageHP >= 0) {
        hpRemoved = damageHP;
        if(hpRemoved <= 0){
            hpRemoved = 1;
        }

        currentFighters[defender].hp -= hpRemoved;
    }

    strAttack += " removed " + hpRemoved + " HP from "+currentFighters[defender].character;


    fChatLibInstance.sendMessage(strAttack, channel);

    checkLifePoints();
}

function nextTurn(swapTurns) {
    currentFight.turn++;

    if(swapTurns == undefined || swapTurns == true){
        currentFight.whoseturn = (currentFight.whoseturn == 0 ? 1 : 0);
    }


    if(currentFight.winner == -1){
        broadcastCombatInfo();
    }
}

function checkLifePoints() {
    //test
    if (currentFighters[0].hp <= 0) {
        currentFighters[0].hp = 0;
        currentFight.winner = 1;
    }
    if (currentFighters[1].hp <= 0) {
        currentFighters[1].hp = 0;
        currentFight.winner = 0;
    }


    if (currentFight.winner > -1) {
        //winner!
        fChatLibInstance.sendMessage("[b]After  #" + currentFight.turn + " turns[/b]\n" +
            "[b]" + currentFighters[currentFight.winner].character + "[/b] has finally taken " + currentFighters[(currentFight.winner == 0 ? 1 : 0)].character + " down!\nCongratulations to the winner!"
            , channel);
        addWinsLosses(currentFighters[currentFight.winner].character, currentFighters[(currentFight.winner == 0 ? 1 : 0)].character);
        setTimeout(resetFight, 2500);
    }

}

function addWinsLosses(winnerName, loserName){
    client.hgetall(winnerName, function (err, result) {
        if (!err) {
            if(result == null){
                result = {};
            }
            var wins = 1;
            if(result != undefined && result.wins != undefined && !isNaN(result.wins)){
                wins = parseInt(result.wins) + 1;
            }
            result.wins = wins;
            if(result != undefined && result.history == undefined){
                result.history = "";
            }
            result.history = "[color=green][b]WON[/b][/color] against "+loserName;
            client.hmset(winnerName, result);
        }
        else {
            fChatLibInstance.sendMessage("Attempt to add the victory point failed.", channel);
        }
    });

    client.hgetall(loserName, function (err, result) {
        if (!err) {
            if(result == null){
                result = {};
            }
            var losses = 1;
            if(result != undefined && result.losses != undefined && !isNaN(result.losses)){
                losses = parseInt(result.losses) + 1;
            }
            result.losses = losses;
            if(result != undefined && result.history == undefined){
                result.history = "";
            }
            result.history = "[color=red][b]LOST[/b][/color] against "+winnerName;
            client.hmset(loserName, result);
        }
        else {
            fChatLibInstance.sendMessage("Attempt to add the loss point failed.", channel);
        }
    });
}

function resetFight() {
    currentFighters = [];
    currentFight = {bypassTurn: false, turn: -1, whoseturn: -1, isInit: false, orgasms: 0, winner: -1, currentHold: {}, actionTier: "", actionType: "", dmgHp: 0, dmgLust: 0, actionIsHold: false, diceResult: 0, intMovesCount: [0,0]};
}

function broadcastCombatInfo() {
    if (checkIfFightIsGoingOn()) {
        fChatLibInstance.sendMessage(
            "\n" +
            "[b]Turn #" + currentFight.turn + "[/b] --------------- It's [b][u][color=pink]" + currentFighters[currentFight.whoseturn].character + "[/color][/u][/b]'s turn.\n\n" +
            (currentFighters.length > 0 ? (currentFighters[0].armsTied ? "[color=red]" : "")+"[b]" + currentFighters[0].character + ": [/b]" + (currentFighters[0].armsTied ? "[/color]" : "")+ currentFighters[0].hp + "/" + maxHp + " [color=red]HP[/color]  |  " + currentFighters[0].odds + "/100 [color=pink]Odds[/color]  |  "+(currentFighters[0].headTied ? "[b]" : "[s]")+"Head tied"+(currentFighters[0].headTied ? "[/b]" : "[/s]")+", "+(currentFighters[0].armsTied ? "[b]" : "[s]")+"Arms tied"+(currentFighters[0].armsTied ? "[/b]" : "[/s]")+", "+(currentFighters[0].legsTied ? "[b]" : "[s]")+"Legs tied"+(currentFighters[0].legsTied ? "[/b]" : "[/s]")+(currentFighters[0].armsTied ? " [color=red][b]Locked Up![/b][/color]" : "")+"\n" : "") +
            (currentFighters.length > 1 ? (currentFighters[1].armsTied ? "[color=red]" : "")+"[b]" + currentFighters[1].character + ": [/b]" + (currentFighters[1].armsTied ? "[/color]" : "")+ currentFighters[1].hp + "/" + maxHp + " [color=red]HP[/color]  |  " + currentFighters[1].odds + "/100 [color=pink]Odds[/color]  |  "+(currentFighters[1].headTied ? "[b]" : "[s]")+"Head tied"+(currentFighters[1].headTied ? "[/b]" : "[/s]")+", "+(currentFighters[1].armsTied ? "[b]" : "[s]")+"Arms tied"+(currentFighters[1].armsTied ? "[/b]" : "[/s]")+", "+(currentFighters[1].legsTied ? "[b]" : "[s]")+"Legs tied"+(currentFighters[1].legsTied ? "[/b]" : "[/s]")+(currentFighters[1].armsTied ? " [color=red][b]Locked Up![/b][/color]" : "") : "")
            , channel);
    }
    else {
        fChatLibInstance.sendMessage("There is no match going on at the moment.", channel);
    }
}

function checkIfFightIsGoingOn() {
    if (currentFight.turn > 0 && currentFighters.length == 2 && currentFight.whoseturn != -1) {
        return true;
    }
    return false;
}


function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}
