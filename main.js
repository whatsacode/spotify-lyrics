 //handle setupevents as quickly as possible
 const setupEvents = require('./installers/setupEvents')
 if (setupEvents.handleSquirrelEvent()) {
    // squirrel event handled and app will exit in 1000ms, so don't do anything else
    return;
 }


const electron = require('electron');
const url = require('url');
const path = require('path');
const SpotifyWebHelper = require('spotify-web-helper');
const api = require('genius-api');
const Lyricist = require('lyricist/node6');
const configFile = require('./config.js');

process.env.GENIUS_ACCESS_TOKEN = configFile.GENIUS_API_TOKEN;

const{app,BrowserWindow,Menu, ipcMain, dialog} = electron;
const helper = SpotifyWebHelper();
const genius = new api(process.env.GENIUS_ACCESS_TOKEN);
const lyricist = new Lyricist(process.env.GENIUS_ACCESS_TOKEN);

let mainWindow;

var currentTrack;
var currentHeight = 640;

/*
===================================== WINDOWS =================================
*/

// Listen for app to be ready
app.on('ready', function(){

    mainWindow = new BrowserWindow({
        width: 1024, 
        height: currentHeight,
        backgroundColor:'#181818',
        show: false,
        title:'Spotify Lyrics'
    });

    mainWindow.once('ready-to-show', ()=>{
        mainWindow.show();
    });

    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'mainWindow.html'),
        protocol:'file:',
        slashes: true
    }));

    // Send current height on resize to adjust scrollbar
    mainWindow.on('resize', function(e){
        var height = mainWindow.getSize()[1];
        if(currentHeight != height){
            currentHeight = height;
            mainWindow.webContents.send('window:resize', height);
        }
    })

    // Quit App when closed
    mainWindow.on('closed', function(){
        app.quit();
    })

    // Remove Menu Bar
   // mainWindow.setMenu(null);
});

/*
===================================== IPC =================================
*/

// Catch item:add
ipcMain.on('song:refresh', function(e){
    updatePlayingSong(undefined);
});

// Catch choosesong:open
ipcMain.on('choosesong:open', function(e){
    chooseSongWindow();
});

ipcMain.on('song:changed_by_user',function(e,song_lyric){
    updateShownLyrics(song_lyric);
});

// When lyrics are cleared, need to set current song to undefined in case the last song comes on again (if statement would block the request)
ipcMain.on('lyrics:cleared',function(e){
    currentTrack = undefined;
});


/*
================================ SPOTIFY HELPER ===========================
*/

helper.player.on('error', err => {
    // TODO Check if internet is working
    // TODO no message when spotify is running but not playing a song

    // If = undefined, spotify is not running
    if(err.message == undefined){
        console.log("1");
        mainWindow.webContents.send('spotify:error', {message: 'Spotify is not running',title: 'Error'});
    }if (err.message.match(/No user logged in/)) {
        console.log("2");
        mainWindow.webContents.send('spotify:error', {message: 'No user is logged in to Spotify' ,title: 'Error'});
    }else{
        console.log("3");
        if(helper.status == null){
            console.log("4");

            mainWindow.webContents.send('spotify:error', {message: 'You\'re not connected to the internet' ,title: 'Error'});
        }else{
            console.log("5");
            mainWindow.webContents.send('spotify:error', {message: 'Unknown error occured' ,title: 'Error'});
            //TODO when does this happen?
            console.log(err);
        }
    }
    console.log("6");
});

helper.player.on('ready', () => {

    // If player works, internet and spotify work, so we can remove any error messages that might be showing
    mainWindow.webContents.send('spotify:running');
    
    if(helper.status.playing == false){
        mainWindow.webContents.send('spotify:error', {message: 'No song is playing' ,title: ''});
    }

    helper.player.on('track-will-change', function(track){ 
        console.log("1 track-will-change");
        if(track != currentTrack){
            mainWindow.webContents.send('toast:lyrics-loading',track);
            updatePlayingSong(track); 
        }
    });

    //Playback events
    helper.player.on('play', function(){ 
        updatePlayingSong(undefined); 
    });
    
    helper.player.on('pause', () => { console.log('pause') });

    helper.player.on('seek', newPosition => { console.log('seek') });

    helper.player.on('end', () => { console.log('end') });

    helper.player.on('status-will-change', status => { console.log('2 status-will-change') });
});

/*
================================ FUNCTIONS ===========================
*/

// Receive currently playing track from spotify helper and look it up on genius, send results via ipc
function updatePlayingSong(spotify_track) {

    // If spotify is not running/doesn't have internet connection =null
    if(helper.status===null){
        mainWindow.webContents.send('spotify:error', {message: 'Can\'t connect to Spotify',title: 'Error'});
        return;
    }

    // Status update
    mainWindow.webContents.send('status:change', 'Getting song info from Spotify');

    // Receive track object from spotify web helper (either through parameters on method or straight from helper.status)
    var track;
    if(spotify_track==undefined){
        track = helper.status.track;
    }else{
        track = spotify_track;
    }
    currentTrack = track;

    console.log("Searching for: "+track.track_resource.name+ " / "+track.artist_resource.name);

    // Status update
    mainWindow.webContents.send('status:change', 'Searching for "'+track.track_resource.name+'" on Genius.com');

    // Search for track name + artist name
    //TODO search for live songs doesnt work, filter out 'live'
    genius.search(track.track_resource.name + ' ' + track.artist_resource.name ).then(function(response) {

        mainWindow.webContents.send('possible_songs:list', response.hits);

        updateShownLyrics(response.hits[0]);

    }).catch(function(error) {
        console.error(error);
        dialog.showErrorBox("Error in genius search", error);
    });
}

function updateShownLyrics(genius_lyrics){

    if(genius_lyrics == undefined){
        dialog.showErrorBox("yikes. weird error occured", error);
    }

    // Status update
    mainWindow.webContents.send('status:change', 'Scraping lyrics from Genius.com');

    // Use the first results id to scrape the lyrics with lyricist
    lyricist.song(genius_lyrics.result.id,{fetchLyrics: true}).then(function(song) {
        mainWindow.webContents.send('spotify:running');
        mainWindow.webContents.send('lyrics:show', song);
    }).catch(function(error) {
        console.log(error);
        dialog.showErrorBox("Error in Lyricist scraping", error);
    });
}