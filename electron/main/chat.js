const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const https = require('https');

class ChatManager {
    constructor(db, userDataPath) {
        this.db = db;
        this.configPath = path.join(userDataPath, 'llm_config.json');
        this.config = null;
        this.conversations = new Map(); // Store conversation state
        this.handlers = []; // Add this to track handlers
        
        this.initializeHandlers();
        this.loadConfig();  
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            this.config = JSON.parse(data);
        } catch (error) {
            this.config = null;
        }
    }

    async saveConfig(config) {
        try {
            await fs.writeFile(this.configPath, JSON.stringify(config));
            this.config = config;
            return { success: true };
        } catch (error) {
            console.error('Error saving config:', error);
            throw error;
        }
    }

    async getRecentTweets() {
        try {
            const data = await this.db.getTweets();
            const allTweets = [];
            
            // Extract tweets from all sessions
            Object.values(data.sessionsByDate).forEach(sessions => {
                sessions.forEach(session => {
                    session.tweets.forEach(tweet => {
                        allTweets.push({
                            content: tweet.content,
                            timestamp: tweet.timestamp,
                            user: tweet.user_name
                        });
                    });
                });
            });
            
            // Sort by timestamp (most recent first) and limit to 100
            return allTweets
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 100);
        } catch (error) {
            console.error('Error fetching tweets:', error);
            throw error;
        }
    }

    async queryLLM(messages) {
        if (!this.config?.endpoint) {
            throw new Error('LLM endpoint not configured');
        }

        console.log(`queryLLM called with ${messages.length} messages, using model type: ${this.config.type}`);

        try {
            if (this.config.type === 'gemini') {
                // Google Gemini API call
                const headers = {
                    'Content-Type': 'application/json'
                };

                // Combine messages into a single prompt for Gemini
                const combinedContent = messages.map(msg => {
                    if (msg.role === 'system') {
                        return `Instructions: ${msg.content}\n\n`;
                    }
                    return `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}\n`;
                }).join('\n');

                const body = {
                    contents: [{
                        parts: [{
                            text: combinedContent
                        }]
                    }],
                    generationConfig: {
                        temperature: this.config.temperature || 0.1,
                        topP: this.config.topP || 0.9,
                        maxOutputTokens: this.config.maxTokens || 512
                    }
                };

                // Construct Gemini API URL with API key
                const endpoint = `${this.config.endpoint}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

                console.log('Sending Gemini query to:', endpoint);
                console.log('Gemini request body length:', JSON.stringify(body).length);

                return new Promise((resolve, reject) => {
                    const url = new URL(endpoint);
                    const options = {
                        hostname: url.hostname,
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers: headers
                    };

                    console.log('Gemini request options:', { 
                        hostname: url.hostname,
                        path: url.pathname.split('?')[0], // don't log API key
                        method: 'POST'
                    });

                    const req = https.request(options, (res) => {
                        let data = '';

                        res.on('data', (chunk) => {
                            data += chunk;
                            console.log(`Received chunk of data: ${chunk.length} bytes`);
                        });

                        res.on('end', () => {
                            console.log(`Gemini API response status: ${res.statusCode}`);
                            console.log(`Total response data length: ${data.length} bytes`);
                            
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    if (responseData.candidates && responseData.candidates[0]?.content?.parts[0]?.text) {
                                        const responseText = responseData.candidates[0].content.parts[0].text;
                                        console.log(`Gemini response received, length: ${responseText.length}`);
                                        resolve(responseText);
                                    } else {
                                        console.error('Invalid Gemini API response format:', responseData);
                                        reject(new Error('Invalid Gemini API response format'));
                                    }
                                } catch (error) {
                                    console.error('Failed to parse Gemini response:', error);
                                    console.error('Raw response:', data);
                                    reject(new Error(`Failed to parse Gemini response: ${error.message}`));
                                }
                            } else {
                                console.error(`Gemini API error (${res.statusCode}):`, data);
                                reject(new Error(`Gemini API error (${res.statusCode}): ${data}`));
                            }
                        });
                    });

                    req.on('error', (error) => {
                        console.error('Gemini request failed:', error);
                        reject(new Error(`Gemini request failed: ${error.message}`));
                    });

                    req.write(JSON.stringify(body));
                    req.end();
                });
            } else {
                // OpenAI-compatible API call
                const headers = {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey && { 
                        'Authorization': `Bearer ${this.config.apiKey}`
                    })
                };

                const body = {
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    model: this.config.model,
                    max_tokens: this.config.maxTokens || 512,
                    temperature: this.config.temperature || 0.1,
                    top_p: this.config.topP || 0.9
                };

                const endpoint = this.config.endpoint.endsWith('/v1/chat/completions') 
                    ? this.config.endpoint 
                    : `${this.config.endpoint.replace(/\/$/, '')}/v1/chat/completions`;

                console.log('Sending OpenAI query to:', endpoint);
                console.log('OpenAI request body length:', JSON.stringify(body).length);

                return new Promise((resolve, reject) => {
                    const url = new URL(endpoint);
                    const options = {
                        hostname: url.hostname,
                        path: url.pathname,
                        method: 'POST',
                        headers: headers
                    };

                    console.log('OpenAI request options:', { 
                        hostname: url.hostname,
                        path: url.pathname,
                        method: 'POST'
                    });

                    const req = https.request(options, (res) => {
                        let data = '';
                        
                        res.on('data', (chunk) => {
                            data += chunk;
                            console.log(`Received chunk of data: ${chunk.length} bytes`);
                        });

                        res.on('end', () => {
                            console.log(`OpenAI API response status: ${res.statusCode}`);
                            console.log(`Total response data length: ${data.length} bytes`);
                            
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    
                                    if (responseData.choices && responseData.choices[0]) {
                                        const responseText = responseData.choices[0].message.content;
                                        console.log(`OpenAI response received, length: ${responseText.length}`);
                                        // Debug first and last 100 chars of the response
                                        console.log(`Response start: "${responseText.substring(0, 100)}..."`);
                                        console.log(`Response end: "...${responseText.substring(responseText.length - 100)}"`);
                                        resolve(responseText);
                                    } else {
                                        console.error('Invalid OpenAI API response format:', responseData);
                                        reject(new Error('Invalid OpenAI API response format'));
                                    }
                                } catch (error) {
                                    console.error('Failed to parse OpenAI response:', error);
                                    console.error('Raw response (first 500 chars):', data.substring(0, 500));
                                    reject(new Error(`Failed to parse OpenAI response: ${error.message}`));
                                }
                            } else {
                                console.error(`OpenAI API error (${res.statusCode}):`, data);
                                reject(new Error(`OpenAI API error (${res.statusCode}): ${data}`));
                            }
                        });
                    });

                    req.on('error', (error) => {
                        console.error('OpenAI request failed:', error);
                        reject(new Error(`OpenAI request failed: ${error.message}`));
                    });

                    req.write(JSON.stringify(body));
                    req.end();
                });
            }
        } catch (error) {
            console.error('Error in queryLLM:', error);
            throw error;
        }
    }

    async naturalToMongoQuery(naturalQuery) {
        try {
            // Extract number of tweets if specified using the enhanced pattern matching
            let limit = 100; // Default to 100 if not specified
            
            // Match patterns like "500 tweets", "top 300 tweets", "100 most recent tweets", etc.
            const quantityRegex = /\b(\d+)\s*(tweets|posts|most recent|latest|top)\b|\b(top|latest|most recent)\s*(\d+)\s*(tweets|posts)\b/i;
            const match = naturalQuery.match(quantityRegex);
            
            if (match) {
                // Extract the number from the match groups - could be in group 1 or group 4
                const numberStr = match[1] || match[4];
                if (numberStr) {
                    const parsedLimit = parseInt(numberStr);
                    if (!isNaN(parsedLimit) && parsedLimit > 0) {
                        limit = parsedLimit;
                        console.log(`Extracted tweet limit from query: ${limit}`);
                    }
                }
            }
            
            const systemPrompt = {
                role: 'system',
                content: `You are a MongoDB query generator. Convert natural language instructions into MongoDB query objects.

                            The MongoDB collection is named tweets and has the following fields:
                            - content: tweet text
                            - user_name: author's display name
                            - user_handle: author's Twitter handle
                            - timestamp: date of tweet (ISODate format)
                            - metrics: { replies, retweets, likes, views }
                            - url: tweet URL

                            IMPORTANT RULES:
                            1. Only return a complete query object with sort and limit.
                            2. Format must be: { "sort": {}, "limit": number }
                            3. Do not use $text, $regex, or any special MongoDB operators.
                            4. Do not return comments, explanations, or shell commands.
                            5. Always include both sort and limit.
                            6. Default sort: { "timestamp": -1 }
                            7. Default limit: 100
                            8. Maximum limit: 1000

                            Sort priorities:
                            - Use "metrics.likes": -1 if the query refers to "liked"
                            - Use "metrics.retweets": -1 if the query refers to "retweeted"
                            - Use "metrics.views": -1 if the query refers to "viewed"
                            - Use "timestamp": -1 if query refers to "latest", "recent", or doesn't specify
                            - Combine sorts when applicable (e.g., likes + retweets)

                            EXAMPLES:

                            Input: get top 500 tweets  
                            Output:
                            {
                            "sort": { "timestamp": -1 },
                            "limit": 500
                            }

                            Input: show most liked tweets  
                            Output:
                            {
                            "sort": { "metrics.likes": -1, "metrics.retweets": -1 },
                            "limit": 100
                            }

                            Input: get 200 most viewed tweets  
                            Output:
                            {
                            "sort": { "metrics.views": -1 },
                            "limit": 200
                            }

                            Input: latest tweets from this week  
                            Output:
                            {
                            "sort": { "timestamp": -1 },
                            "limit": 100
                            }

                            GOAL:
                            Return only the MongoDB query object. No text. No markdown. No extra formatting.`
            };

            const userPrompt = {
                role: 'user',
                content: `Return a complete MongoDB query object with sort and limit for: ${naturalQuery}`
            };

            const response = await this.queryLLM([systemPrompt, userPrompt]);
            
            // Clean the response by removing markdown code blocks and any extra whitespace
            const cleanedResponse = response
                .replace(/```(?:json|javascript)?\n?/g, '') // Remove code block markers
                .replace(/`/g, '')                          // Remove any remaining backticks
                .replace(/^db\.tweets\.find\((.+)\).*$/s, '$1') // Remove any db.tweets.find() wrapper
                .trim();                                    // Remove extra whitespace

            try {
                // Parse the cleaned response
                let queryObject = JSON.parse(cleanedResponse);
                
                // Validate the query structure
                if (!queryObject.sort || !queryObject.limit) {
                    throw new Error('Invalid query structure. Missing required fields.');
                }

                // Override with the extracted limit if it exists
                if (limit !== 100) {
                    console.log(`Using extracted limit from query: ${limit}`);
                    queryObject.limit = Math.min(limit, 1000); // Cap at 1000 tweets
                } else {
                    // Ensure we have a reasonable limit (use LLM-generated one)
                    queryObject.limit = Math.min(queryObject.limit || 100, 1000); // Cap at 1000 tweets
                }

                // If no specific sort is provided, default to timestamp
                if (!queryObject.sort || Object.keys(queryObject.sort).length === 0) {
                    queryObject.sort = { "timestamp": -1 };
                }

                // Remove any extra fields and keep only sort and limit
                return {
                    sort: queryObject.sort,
                    limit: queryObject.limit
                };
            } catch (error) {
                console.error('Failed to parse LLM response:', error);
                console.error('Raw response:', response);
                console.error('Cleaned response:', cleanedResponse);
                
                // Return a default query with the extracted limit for any parsing errors
                return {
                    sort: { "timestamp": -1 },
                    limit: limit  // Use the extracted limit
                };
            }
        } catch (error) {
            console.error('Error generating MongoDB query:', error);
            // Return a default query for any errors
            return {
                sort: { "timestamp": -1 },
                limit: 100
            };
        }
    }

    async executeMongoQuery(naturalQuery) {
        try {
            // Generate MongoDB query
            const mongoQuery = await this.naturalToMongoQuery(naturalQuery);
            
            if (this.db.shareData) {
                // Execute the query with sort and limit from MongoDB
                const results = await this.db.db.collection(this.db.collections.TWEETS)
                    .find(mongoQuery.query)
                    .sort(mongoQuery.sort)
                    .limit(mongoQuery.limit)
                    .toArray();
                    
                return {
                    query: mongoQuery,
                    results: results,
                    count: results.length
                };
            } else {
                // Execute the query with sort and limit from local storage
                const allTweets = [];
                const files = await fs.readdir(this.db.localDataDir);
                
                // Get file stats and sort files by creation time (latest first)
                const fileStats = await Promise.all(
                    files
                        .filter(file => file.startsWith('session_') && file.endsWith('.json'))
                        .map(async file => {
                            const filePath = path.join(this.db.localDataDir, file);
                            const stats = await fs.stat(filePath);
                            return { file, filePath, birthtime: stats.birthtime };
                        })
                );
                
                // Sort files by creation time (newest first)
                fileStats.sort((a, b) => b.birthtime - a.birthtime);
                
                // Process files in sorted order and collect tweets until we reach the limit
                let totalTweets = 0;
                const limit = mongoQuery.limit || 100;

                for (const { filePath } of fileStats) {
                    if (totalTweets >= limit) break;

                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const sessionData = JSON.parse(fileContent);
                    
                    // Add tweets from this session maintaining their original order
                    sessionData.tweets.forEach(tweet => {
                        if (totalTweets < limit) {
                            allTweets.push({
                                _id: tweet.tweet_id,
                                user_name: tweet.user?.name || 'Unknown User',
                                user_handle: tweet.user?.handle || 'unknown',
                                content: tweet.content,
                                timestamp: new Date(tweet.timestamp),
                                url: tweet.url,
                                metrics: tweet.metrics
                            });
                            totalTweets++;
                        }
                    });
                }
                
                // Apply any additional sorting criteria from mongoQuery if needed
                // (excluding the timestamp sort since we want to maintain scraping order)
                if (Object.keys(mongoQuery.sort).length > 1 || !mongoQuery.sort.hasOwnProperty('timestamp')) {
                    allTweets.sort((a, b) => {
                        for (const [field, direction] of Object.entries(mongoQuery.sort)) {
                            if (field === 'timestamp') continue; // Skip timestamp to maintain scraping order
                            const aValue = field.split('.').reduce((obj, key) => obj[key], a);
                            const bValue = field.split('.').reduce((obj, key) => obj[key], b);
                            if (aValue !== bValue) {
                                return direction === -1 ? bValue - aValue : aValue - bValue;
                            }
                        }
                        return 0;
                    });
                }
                
                return {
                    query: mongoQuery,
                    results: allTweets,
                    count: allTweets.length
                };
            }
        } catch (error) {
            console.error('Error executing query:', error);
            throw error;
        }
    }

    isTimeBasedQuery(query) {
        const timeKeywords = ['latest', 'recent', 'last', 'past', 'today', 'yesterday', 'week', 'month', 'days'];
        return timeKeywords.some(keyword => query.toLowerCase().includes(keyword));
    }

    // Add new method to detect quantity-based queries
    hasQuantitySpecification(query) {
        // Match patterns like "500 tweets", "top 300 tweets", "100 most recent tweets", etc.
        const quantityRegex = /\b(\d+)\s*(tweets|posts|most recent|latest|top)\b|\b(top|latest|most recent)\s*(\d+)\s*(tweets|posts)\b/i;
        const match = query.match(quantityRegex);
        
        if (match) {
            console.log('Quantity specification detected in query:', match[0]);
            return true;
        }
        
        return false;
    }

    isUserSpecificQuery(query) {
        return query.toLowerCase().includes('from user') || 
               query.toLowerCase().includes('by user') ||
               query.includes('@');
    }

    async handleTimeBasedQuery(query) {
        // Skip asking for time specification if a quantity is already specified
        if (this.hasQuantitySpecification(query)) {
            console.log('Query already has quantity specification, skipping timeframe prompt');
            return null;
        }
        
        // Return a prompt asking for time specification if not provided
        if (!query.match(/\d+\s*(day|week|month|year)s?/i)) {
            return {
                needsMoreInfo: true,
                prompt: "How many days of tweets would you like to analyze?\n\n(Tip: In the future, you can directly specify the number of tweets in your query, like 'Analyze top 500 tweets' to skip this step.)"
            };
        }
        return null; // Continue with normal processing
    }

    async processNaturalQuery(query, timeframe = null) {
        let naturalQuery = query;
        
        // If timeframe is provided and it's not already a quantity-based query, modify the query
        if (timeframe && !this.hasQuantitySpecification(query)) {
            const days = parseInt(timeframe);
            if (!isNaN(days)) {
                const dateQuery = `from the last ${days} days`;
                naturalQuery = `${query} ${dateQuery}`;
            }
        }

        return await this.executeMongoQuery(naturalQuery);
    }

    async analyzeTweets(tweets, userPrompt) {
        console.log(`analyzeTweets called with ${tweets.length} tweets and prompt: ${userPrompt}`);
        
        const defaultSystemPrompt = `You are an intelligent and context-aware assistant that specializes in analyzing Twitter data. The user will provide a collection of tweets — which may include posts, replies, retweets, or quoted tweets — often spanning different users, tones, and topics.

                            Your job is to:

                            Understand the overarching context, sentiment, and themes in the tweets.

                            Identify patterns, trends, public sentiment, or key points of discussion.

                            Prioritize clarity, usefulness, and accuracy in your summaries or insights.

                            Anticipate what a user might be looking for: whether it's trend analysis, sentiment breakdown, topic categorization, influential users, or anomalies.

                            When unsure about intent, infer the most likely goal based on the data and give your best intelligent guess with transparency.

                            Keep your responses concise, well-structured, and highly informative. When relevant, use bullet points, summaries, or categories.

                            Be analytical, but conversational. Avoid generic fluff. Use examples from the tweet data to support your insights when possible.`;

        // Use a sample of tweets if there are too many to avoid token limits
        let tweetsToAnalyze = tweets;
        if (tweets.length > 50) {
            console.log(`Sampling ${50} tweets from the total of ${tweets.length}`);
            tweetsToAnalyze = tweets.slice(0, 50);
        }

        try {
            const messages = [
                {
                    role: 'system',
                    content: this.config?.systemPrompt || defaultSystemPrompt
                },
                {
                    role: 'user',
                    content: `Analyze these tweets: ${JSON.stringify(tweetsToAnalyze)}\n\nUser request: ${userPrompt}`
                }
            ];

            console.log('Sending query to LLM with message length:', 
                        messages[0].content.length + messages[1].content.length);
            
            const result = await this.queryLLM(messages);
            console.log('Received response from LLM, length:', result ? result.length : 0);
            console.log('Response preview:', result ? result.slice(0, 200) + '...' : 'No response');
            console.log('Response end:', result ? '...' + result.slice(-200) : 'No response');
            
            return result;
        } catch (error) {
            console.error('Error in analyzeTweets:', error);
            throw error;
        }
    }

    async parseGoalsFromQuery(query) {
        try {
            console.log('Parsing goals from query:', query);
            
            const systemPrompt = {
                role: 'system',
                content: `You are an AI assistant that helps users to perform actions as passed into the user prompt. Your job is to break down user requests into clear, actionable goals and steps.

                Given a user's query about Twitter data, you should:
                1. Identify the main objective
                2. Break it down into 2-4 sequential goals/steps
                3. Format your response as follows:

                I'll help you [main objective]. Here's my plan:

                **Goals:**
                1. [First goal]: [Brief explanation]
                2. [Second goal]: [Brief explanation]
                3. [Third goal, if applicable]: [Brief explanation]

                Would you like me to proceed with this plan?

                IMPORTANT GUIDELINES:
                - Be specific and clear about what you'll analyze
                - Focus only on Twitter data analysis goals
                - Keep explanations concise but informative
                - Make sure goals are sequential and build on each other
                - Limit to 2-4 goals maximum
                - If the query is very simple, still break it into at least 2 logical steps
                - Do not reference any UI elements or technical implementation details
                `
            };

            const userPrompt = {
                role: 'user',
                content: `Parse this user provided query request into goals: ${query}`
            };

            const response = await this.queryLLM([systemPrompt, userPrompt]);
            console.log('Goals parsed from LLM:', response);
            
            return {
                success: true,
                goalsResponse: response
            };
        } catch (error) {
            console.error('Error parsing goals:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async executeGoal(goal, tweets, originalQuery) {
        console.log(`Executing goal: ${goal}`);
        
        const systemPrompt = {
            role: 'system',
            content: `You are an AI assistant analyzing Twitter data. You're currently executing a specific user provided goal.
                      
                      Focus only on completing the current goal. Be thorough yet concise in your analysis.
                      Use specific examples from the provided tweets.
                      Format your response well with headings, bullet points, and paragraphs as appropriate.
                      
                      Original user query: ${originalQuery}
                      Current goal to execute: ${goal}`
        };

        const userPrompt = {
            role: 'user',
            content: `Complete this analysis goal using these tweets: ${JSON.stringify(tweets.slice(0, 50))}`
        };

        const result = await this.queryLLM([systemPrompt, userPrompt]);
        console.log('Goal execution result length:', result ? result.length : 0);
        
        return result;
    }

    initializeHandlers() {
        // Store handlers so we can remove them later
        this.handlers = [
            { channel: 'save-llm-config', handler: async (event, config) => await this.saveConfig(config) },
            { channel: 'get-llm-config', handler: async () => this.config },
            { channel: 'chat-query', handler: async (event, { query, conversationId, timeframe = null, approveGoals = false, executingGoalIndex = null }) => {
                try {
                    console.log('Received chat query:', { query, conversationId, timeframe, approveGoals, executingGoalIndex });
                    let conversation = this.conversations.get(conversationId);
                    if (!conversation) {
                        // Initialize a new conversation
                        console.log(`Creating new conversation with ID: ${conversationId}`);
                        conversation = { state: 'initial', context: {} };
                        this.conversations.set(conversationId, conversation);
                    } else {
                        console.log(`Using existing conversation with ID: ${conversationId}, state: ${conversation.state}`);
                    }

                    // If this is a goal approval response
                    if (approveGoals) {
                        console.log('User approved goals, setting up for execution');
                        conversation.state = 'executing_goals';
                        conversation.context.currentGoalIndex = 0;
                        conversation.context.originalQuery = query;
                        
                        // Execute natural query to get tweets for analysis
                        console.log('Getting tweets for goal execution...');
                        const queryResults = await this.processNaturalQuery(query, timeframe);
                        conversation.context.tweets = queryResults.results;
                        conversation.context.queryDetails = queryResults.query;
                        conversation.context.tweetCount = queryResults.count;
                        
                        // Execute all goals sequentially
                        console.log(`Executing all ${conversation.context.goals.length} goals for conversation ${conversationId}`);
                        
                        const allGoalResults = [];
                        
                        // Execute each goal one by one
                        for (let i = 0; i < conversation.context.goals.length; i++) {
                            console.log(`Executing goal ${i + 1}/${conversation.context.goals.length}`);
                            
                            // Send progress update before executing this goal
                            if (event.sender) {
                                event.sender.send('goal-execution-progress', {
                                    goalIndex: i,
                                    totalGoals: conversation.context.goals.length,
                                    goal: conversation.context.goals[i],
                                    status: 'executing',
                                    conversationId: conversationId
                                });
                                
                                // Add a small delay to ensure UI can process
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                            
                            // Execute the goal
                            const goalResult = await this.executeGoal(
                                conversation.context.goals[i], 
                                conversation.context.tweets,
                                conversation.context.originalQuery
                            );
                            
                            // Store the result
                            allGoalResults.push({
                                goalIndex: i,
                                goal: conversation.context.goals[i],
                                result: goalResult
                            });
                            
                            // Send progress update after executing this goal
                            if (event.sender) {
                                event.sender.send('goal-execution-progress', {
                                    goalIndex: i,
                                    totalGoals: conversation.context.goals.length,
                                    goal: conversation.context.goals[i],
                                    status: 'completed',
                                    result: goalResult,
                                    conversationId: conversationId
                                });
                                
                                // Add a small delay to ensure UI can process
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                        }
                        
                        // Reset state after execution
                        conversation.state = 'initial';
                        
                        // Return all goal results
                        return {
                            success: true,
                            isGoalExecution: true,
                            isComplete: true,
                            allGoalResults: allGoalResults,
                            totalGoals: conversation.context.goals.length,
                            queryDetails: queryResults.query,
                            tweetCount: queryResults.count
                        };
                    }
                    
                    // If we're in the process of executing goals
                    if (executingGoalIndex !== null && conversation.state === 'executing_goals') {
                        // This path won't be used with automatic execution
                        // But kept for backward compatibility
                        console.log('Legacy goal execution path called - should not happen');
                        
                        // Reset state
                        conversation.state = 'initial';
                        
                        return {
                            success: true,
                            isGoalExecution: true,
                            isComplete: true,
                            response: "All analysis goals have been completed. Is there anything else you'd like to know about the data?",
                            queryDetails: conversation.context.queryDetails,
                            tweetCount: conversation.context.tweetCount
                        };
                    }

                    // Handle time-based queries
                    if (this.isTimeBasedQuery(query)) {
                        const timeCheck = await this.handleTimeBasedQuery(query);
                        if (timeCheck?.needsMoreInfo) {
                            conversation.state = 'awaiting_timeframe';
                            conversation.context.originalQuery = query;
                            console.log('Requesting timeframe from user');
                            return {
                                success: true,
                                needsMoreInfo: true,
                                prompt: timeCheck.prompt
                            };
                        }
                    }

                    // If we were waiting for timeframe and got it
                    if (conversation.state === 'awaiting_timeframe') {
                        query = conversation.context.originalQuery;
                        timeframe = timeframe || query; // Use the provided timeframe
                        conversation.state = 'initial';
                    }
                    
                    // Parse the query into goals first
                    console.log('Parsing query into goals...');
                    const goalsResult = await this.parseGoalsFromQuery(query);
                    
                    if (goalsResult.success) {
                        // Extract goals from response
                        const goalResponse = goalsResult.goalsResponse;
                        
                        // Find the list of goals in the response using regex
                        const goalRegex = /\*\*Goals:\*\*\s*([\s\S]+?)(?=\n\n|$)/;
                        const match = goalResponse.match(goalRegex);
                        
                        if (match && match[1]) {
                            // Extract individual goals
                            const goalList = match[1].split(/\n\d+\.\s+/).filter(Boolean);
                            console.log('Extracted goals:', goalList);
                            
                            // Store the goals in the conversation context
                            conversation.state = 'awaiting_goal_approval';
                            conversation.context.goals = goalList;
                            conversation.context.originalQuery = query;
                            
                            return {
                                success: true,
                                awaitingGoalApproval: true,
                                goalsResponse: goalResponse,
                                conversationId: conversationId
                            };
                        }
                    }
                    
                    // Fall back to regular query if goal parsing fails
                    console.log('Falling back to regular query...');
                    
                    // Execute the natural query to get relevant tweets
                    console.log('Processing natural query...');
                    const queryResults = await this.processNaturalQuery(query, timeframe);
                    console.log(`Retrieved ${queryResults.results.length} tweets for analysis`);

                    // Analyze the results based on the user's prompt
                    console.log('Sending tweets to LLM for analysis...');
                    const analysis = await this.analyzeTweets(queryResults.results, query);
                    console.log('Received analysis from LLM, length:', analysis?.length || 0);
                    
                    // Log analysis chunks to verify full response
                    if (analysis) {
                        const chunkSize = 500;
                        console.log(`Logging analysis in ${Math.ceil(analysis.length / chunkSize)} chunks:`);
                        for (let i = 0; i < analysis.length; i += chunkSize) {
                            const chunk = analysis.substring(i, i + chunkSize);
                            console.log(`Chunk ${Math.floor(i / chunkSize) + 1}:`, chunk);
                        }
                    }

                    const response = {
                        success: true,
                        response: analysis,
                        queryDetails: queryResults.query,
                        tweetCount: queryResults.count
                    };
                    
                    console.log('Sending response to renderer:', {
                        success: response.success,
                        responseLength: response.response?.length || 0,
                        tweetCount: response.tweetCount
                    });
                    
                    return response;

                } catch (error) {
                    console.error('Chat query error:', error);
                    throw error;
                }
            }},
            { channel: 'natural-query', handler: async (event, query) => {
                try {
                    const results = await this.executeMongoQuery(query);
                    return {
                        success: true,
                        ...results
                    };
                } catch (error) {
                    console.error('Natural query error:', error);
                    throw error;
                }
            }}
        ];

        // Register handlers
        this.handlers.forEach(({ channel, handler }) => {
            ipcMain.handle(channel, handler);
        });
    }

    cleanup() {
        // Remove all registered handlers
        this.handlers.forEach(({ channel }) => {
            ipcMain.removeHandler(channel);
        });
        this.handlers = [];
        this.conversations.clear();
    }
}

module.exports = ChatManager; 