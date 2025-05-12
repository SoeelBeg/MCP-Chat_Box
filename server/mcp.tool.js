import { config } from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});



// Test Twitter client connectivity
async function testTwitterClient() {
    try {
        console.log("Testing Twitter client...");
        // Check if Twitter credentials are set
        if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET || 
            !process.env.TWITTER_ACCESS_TOKEN || !process.env.TWITTER_ACCESS_TOKEN_SECRET) {
            throw new Error("Missing Twitter API credentials in .env file");
        }

        // Check if Twitter account is connected
        const user = await twitterClient.v2.me();
        console.log("Connected to Twitter account:", user.data.username);

        // Test posting a text tweet
        const testTweetText = "Test tweet from MCP " + Date.now();
        const testTweet = await twitterClient.v2.tweet(testTweetText);
        console.log("Test text tweet posted with ID:", testTweet.data.id);

        // Test posting an image
        const testImagePath = path.resolve(__dirname, "Uploads", "1.jpg");
        if (fs.existsSync(testImagePath)) {
            console.log("Testing image upload with:", testImagePath);
            const mediaId = await twitterClient.v2.uploadMedia(testImagePath);
            console.log("Test image uploaded, ID:", mediaId);
            const mediaTweet = await twitterClient.v2.tweet({
                text: "Test image tweet from MCP " + Date.now(),
                media: { media_ids: [mediaId] },
            });
            console.log("Test image tweet posted with ID:", mediaTweet.data.id);
        } else {
            console.log("Test image not found at:", testImagePath, "Please add 1.jpg to uploads/ folder.");
        }
    } catch (error) {
        console.error("Twitter test failed:", error.message);
        console.error("Error details:", error);
        if (error.data) {
            console.error("Twitter API error data:", error.data);
        }
        throw new Error(`Twitter test failed: ${error.message}`);
    }
}

// Run test when server starts
testTwitterClient().catch((error) => {
    console.error("Initial Twitter test failed:", error.message);
});


export async function createPost(status, imagePath) {
    try {
        let mediaIds = [];

        // Prepare tweet text
        const tweetText = status || "";
        const v1Client = twitterClient.v1;
        const v2Client = twitterClient.v2;
        // If image is provided, upload it using v1Client
        if (imagePath) {
            const absolutePath = path.resolve(__dirname, imagePath);
            console.log("Trying to upload image:", absolutePath);

            if (!fs.existsSync(absolutePath)) {
                throw new Error(`Image file not found: ${absolutePath}`);
            }

            fs.accessSync(absolutePath, fs.constants.R_OK);

            const mediaId = await v1Client.uploadMedia(absolutePath, {
                mimeType: "image/jpeg", // or adjust based on actual image type
            });

            mediaIds = [mediaId];
            console.log("Image uploaded to Twitter, ID:", mediaId);
        }

        // Post tweet with or without media
        const tweetOptions = {
            text: tweetText,
            media: mediaIds.length > 0 ? { media_ids: mediaIds } : undefined,
        };

        console.log("Posting tweet with details:", tweetOptions);
        const newPost = await v2Client.tweet(tweetOptions);

        const responseText = status
            ? `Tweeted: ${status}${imagePath ? " with image" : ""}`
            : `Tweeted image${imagePath ? `: ${path.basename(imagePath)}` : ""}`;

        return {
            content: [
                {
                    type: "text",
                    text: responseText,
                },
            ],
        };
    } catch (error) {
        console.error("Twitter post failed:", error.message);
        if (error.data) {
            console.error("Twitter API error data:", error.data);
        }
        throw new Error(`Failed to post tweet: ${error.message}`);
    }
}
