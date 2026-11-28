# Choir Practice Helper

Helps a choir singer practice their part, by supplying different volume and Left/Right panning blends of all voices.

All audio is copyright Brighton Swing Choir.

## How to use this tool for your own choir

Follow these simple steps to create your own version:

### Step 1: Create a Copy of This Tool (Fork)

1. Go to <https://github.com/MisterZeus/choir-practice-helper>
2. Click the **Fork** button in the top-right corner (it looks like a branch)
3. GitHub will ask you to confirm – just click **Create fork**
4. You now have your own copy of this tool on GitHub!

### Step 2: Remove Brighton Swing Choir Songs

1. On your new GitHub page, go to the **songs** folder
2. You'll see all the song folders (like "Stay", "Santa Baby", etc.)
3. For each song from Brighton Swing Choir that you don't want:
   - Click on the song folder
   - Click the three dots menu **...** at the top right
   - Click **Delete directory**
   - Confirm the deletion

### Step 3: Add Your Own Choir's Songs

For each song you want to add to your practice tool:

1. Go to the **songs** folder in your GitHub copy
2. Click **Add file** → **Create new file**
3. In the filename box, type: `YourSongName/songpart-alto.aac` (replace "YourSongName" with your song's name, and "alto" with the voice part)
4. You'll need audio files for each voice part (alto, soprano, tenor, bass)

**Important:** You'll need audio files in one of these formats:

- `.aac` files (if any of your choir members use iPhones or the Safari browser)
- `.opus` files (recommended – smaller file size)

Each song folder should contain files like:

- `songname-alto.opus` (or .aac)
- `songname-soprano.opus` (or .aac)
- `songname-tenor.opus` (or .aac)
- `songname-bass.opus` (or .aac)

### Step 4: Use Your Tool

1. On your GitHub copy, scroll to find the green **Code** button
2. Click it and copy the link shown
3. In your browser, go to: `https://your-github-username.github.io/choir-practice-helper/`
4. You can now see your own songs!

---

## For more technical help

If you need help converting audio files to the right format, the `songs` folder contains these helper scripts:

- `ConvertToAAC.bat` – converts audio to AAC format
- `ConvertToOpusMono.bat` – converts audio to Opus format
