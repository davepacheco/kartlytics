# kartvid

kartvid is a simple facility for processing Mario Kart 64 still frames from a
screen capture video.  The goal is to take a video of a session and extract
information about the courses played, the characters in each box, each
character's position at every point in the race, and the final lap times.
Future enhancements could include weapon information, too.


# Recommended prerequisites

I've only used kartvid on OS X, but it should run anywhere its dependencies are
available.

The most important dependency is:

- [ffmpeg](http://ffmpeg.org/).  I built v0.10.3 from source using a stock
  configuration.  This is used to decode screen capture videos to portable
  network bitmaps, which can be processed directly by kartvid.

You may also want:

- [homebrew](http://mxcl.github.com/homebrew/), for installing other stuff
- cscope (via "brew install cscope") for source browsing
- imagemagick (via "brew install imagemagick"), for the command-line "convert"
  utility
- Photoshop, the GIMP, or some other image editor.  See information about
  creating masks below.  You'll need support for portable bitmap (PPM or PBM)
  images.  For PS, you can get that using the [CartaPGM
  plugin](http://www.reliefshading.com/software/CartaPGM/CartaPGM.html).

To capture stills and video, I'm using an iGrabber device with the stock
software.


# Approach

The basic approach relies on the fact that most objects in the game are either
2D objects (like text) or 3D objects (like characters) rendered using a series
of 2D sprites, which means you only ever see a few different shots them.  The
simple approach we're taking for now is to create "mask" images for every object
we want to detect that consist of only that object, in the precise position
where we want to look for it, and all other pixels black.  The program can then
check all possible masks against a given frame to identify the objects in it.

To create each mask:

1. Capture a high quality still image (in BMP format) of the object on the
   screen.
2. Open it in an image editor.  (I'm using Photoshop CS5.)  Select only the
   object you want (using the magic wand or magnetic lasso tools, for example),
   invert the selection, and delete the selection.
3. Save the image as a portable bitmap (P6) file.  (You can also save it with
   some other lossless format and use the "convert" tool to convert it to PBM.)


## Object variations

Most objects appear in different sizes depending on whether it's a 1P, 2P, or
3P/4P game.  For now, we're focusing only on the 3P/4P case, and we're assuming
that a given object is always the same size.  The only objects that change size
are the characters themselves, depending on whether the player is zoomed in or
not, and we can work around that by checking two masks for each character (one
for each zoom setting).

We also assume a given object only appears in exactly one position on the
screen, which allows us to compute mask matches pretty efficiently (rather than
trying all possible positions on the screen).  This means we need a mask for
each object in each of the 4 boxes on screen.  (This isn't really that different
than having 1 mask and a set of possible positions for it.)

Importantly, we know we're analyzing a whole video, not just individual frames.
We don't necessarily need to identify all objects in all frames.  We can get
away with only having a single view of character as long as we know that we'll
always see that view at least once in each race.  We use the back view, and we
assume we'll see that just before the race starts.  We don't bother handling any
of the other views of each character.


## Analyzing a race

We identify the start of a race by looking for a special Lakitu object.  (He's
the guy holding the stoplight at the start of the race.)  When we see him, we
should be able to reliably identify the current track and the players in each
box, which are all pretty fixed at that point.  We can also start the race clock
at this point.

While the race is going on, we only monitor the position and lap number for each
player.  This allows us to see all position changes as well as lap times for
each player, up through the 3rd lap.  And these are relatively easy, since
they're just simple text objects.  (The only problem is that the lap counters
are turned off if the user switches to the alternate view.  If this becomes a
problem, we could look for another way to detect lap completion (perhaps by
looking for another Lakitu object).)

We detect when each player finishes the last lap by looking for the large
flashing number indicating their final position.  From this we have the final
results and the final race times.


## Identifying the track

Obviously, to identify the track, we'll want a mask to represent the way the
track appears in at least one of the boxes.  Since different players can have
different zoom levels, which would cause the track to look different in the
initial screen, it would be impractical to try to match the track based on any
combination of player boxes.  So for simplicity, we'll just create masks for the
1P box's zoomed-in and zoomed-out views.  (The rest of the mask will be black.)


# Repo

The repo has:

- src: C code

Building will create:

- out: generated binaries

At runtime it will eventually be assumed that you've manually set up your
workspace with:

- assets/install/bin/ffmpeg (install ffmpeg into assets/install)
- assets/masks (mask files)

This part is totally optional, but I also set mine up with:

- build: where I keep my ffmpeg source
- assets/captures: captured video files
- assets/mask\_sources: original source stills and videos for masks


# Roadmap

This project is just a skeleton today.  The plan is:

- Create a few of the masks (a few characters, a track, "lap" text, lakitu?)
  Be sure to have enough to able to test that the program can discriminate
  between a small number of different situations.
- Write a tool that uses all available masks and prints which ones match a
  given frame.
- Write a bit of metadata so that the above tool can translate mask matches to
  race conditions (e.g., "player 1 on lap 1 of luigi raceway")
- Get enough masks to complete a whole race, and have the tool run through a
  whole video and determine:
    - which track is being played
    - which character is in which box 
    - how long each character took to finish the race
    - bonus: how long each character took for each lap 
- Make the rest of the masks.  Test for false positives.


## Masks so far

We have actual masks for these:

- Lap text for lap 1 in each 4P box.
- Non-final position numbers 1-4 in each 4P box.

We have sources (screen captures) from which we can create the masks for:

- Characters: each one in each box in 4P mode, both zoomed in and zoomed out.
- Tracks: several of the tracks (but not all).

The next set of data to capture are:

- final position numbers (so we can detect the end of the race)
- lap text for laps 2-3 in each box
- real race videos

This should be enough to validate the approach.  If it works well, we can gather
the remaining track images and flesh out the rest.
