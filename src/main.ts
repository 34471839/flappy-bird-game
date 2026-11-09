/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

import "./style.css";

import {
    Observable,
    catchError,
    filter, 
    fromEvent,
    interval,
    map,
    scan,
    switchMap,
    take,
    merge,
    
    
} from "rxjs";
import { fromFetch } from "rxjs/fetch";

/** Constants */

/** 
 * Game canvas dimensions
 */
const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

/** 
 * Bird dimensions
 */
const Birb = {
    WIDTH: 42,
    HEIGHT: 30,
} as const;

/** 
 * Constant variables used in the game
 */
const Constants = {
    //Pipe spawn logic
    PIPE_WIDTH: 50,
    TICK_RATE_MS: 16, 
    PIPESPEED: 3, // pipe movement speed

    //Bird flap constant
    GRAVITY: 0.5,
    
    //Bounce speed range constant
    MIN_BOUNCE: 5,
    MAX_BOUNCE: 8,
    
    //Ghost bird replay constant 
    TRANSPARENCY: 0.2, // transparency of ghost bird
    FREQUENCY: 1, // tick frequency for ghost
     
    //Ghost trail constant
    TRAIL_LENGTH: 20, // number of trail store
    SEED: 1234,

} as const;


// User input

type Key = "Space" | "KeyR" | "KeyG";

/** 
 * Pipe details for spawning when game start
 */
type Pipe = Readonly<{
    x_axis: number;
    gapY: number;
    gapHeight: number;
    id: number;
    pass: boolean;
}>;

/** 
 * pipe information read from map.csv
 */
type PipeData = Readonly<{
    num: number;
    gapY: number;
    gapHeight: number;
    time: number;
}>;

/** 
 * single ghost 
 */
type Ghost = Readonly<{
    Y: number;
    tick: number;
}>;

/** 
 * trail rendering state
 */
type Trail = Readonly<{
    y: number;
}>;

/** 
 * whole record of the ghost for all ghost playback
 */
type GhostList = Readonly<{
    birdMovement: ReadonlyArray<Ghost>;
    gameNum: number;
    finalTick: number;
}>;

/** 
 * current ghost playback state
 */
type DisplayGhost = Readonly<{
    recording: GhostList;
    currentScene: number;
    isFinish: boolean;
}>;

/**
 * Collision variables type
 */
type Collision = Readonly<{
    frameCollision: boolean;
    pipeCollision: boolean;
    hitPipe: number | null;
    bounceVelocity: number;
    latestSeed: number;
}>;

/**
 * Score update variables type
 */
type Score = Readonly<{
    updatedPipes: ReadonlyArray<Pipe>;
    updatedNoScorePipes: ReadonlyArray<number>;
    newScore: number;
}>;

/**
 * bird up and down bouncing type
 */
type UpAndDown = Readonly<{
    newY: number;
    newDropSpeed: number;
    newSeed: number;
}>;

// State processing

/** 
 * Game state set with variables and types
 */
type State = Readonly<{
    // for game end and won
    gameEnd: boolean;
    gameWon: boolean;
    showGameOver: boolean;
    pipesDone: boolean;

    // for bird movement
    birdX: number;
    birdY: number;
    birdDropSpeed: number;
    flap: number;
    rngSeed: number;

    //for score and lives
    lives: number;
    score: number;
    pipes: ReadonlyArray<Pipe>;
    
    // for pipe spawning
    pipeShowTime: number; 
    noScorePipes: ReadonlyArray<number>;

    // for ghost playback
    ghost: boolean;
    ghostRecordings: ReadonlyArray<GhostList>;
    currentRecording: ReadonlyArray<Ghost>;
    currentTick: number;
    gameNum: number;
    runGhost: ReadonlyArray<DisplayGhost>;

    // for trail
    ghostTrailMode: boolean;
    ghostTrail: ReadonlyArray<Trail>;

}>;

/** 
 * Initial state when game start
 */
const initialState: State = {
    // set the game to start from false
    gameEnd: false,
    gameWon: false,
    showGameOver: false,
    pipesDone: false,

    // initialise the bird 
    birdX: Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2,
    birdY: Viewport.CANVAS_HEIGHT / 2 - Birb.HEIGHT / 2,
    birdDropSpeed: 0,
    lives: 3,
    score: 0,
    flap: -5,

    //set the seed
    rngSeed: 12345,

    //empty pipe list and start from 0 seconds
    pipes: [],
    pipeShowTime: 0,
    noScorePipes: [],

    //record the ghost in every game
    ghost: true,
    ghostRecordings: [],
    currentRecording: [],
    currentTick: 0,
    gameNum: 0,
    runGhost: [],

    //start from false with empty list 
    ghostTrailMode: false,
    ghostTrail: [],

};

/**
 * Read csv file into an array
 * @param csvContent map.csv file
 * @returns an array of the pipe data
 */
const readFile = (csvContent: string): ReadonlyArray<PipeData> => {
    const readLines = csvContent.trim().split('\n');

    return readLines.slice(1).map((line, index) => {
        const [readGapY, readGapHeight,readTime] = line.split(',');
        return {
            num: index,
            gapY: parseFloat(readGapY),
            gapHeight: parseFloat(readGapHeight),
            time: parseFloat(readTime)
        };
    });
};

/**
 * Pure RNG generator taken from applied 4
 */ 
abstract class RNG {
    private static m = 0x80000000; // 2^31
    private static a = 1103515245;
    private static c = 12345;

    public static hash = (seed: number): number =>
        (RNG.a * seed + RNG.c) % RNG.m;

    public static scale = (hash: number): number =>
        (2 * hash) / (RNG.m - 1); // in [-1, 1]
}



/**
 * Generate pseudo - random velocity for the bird to bounce off
 * @param seed RNG seed
 * @returns a tuple of [velocity, newSeed]
 */ 
const generateBounceVelocity = (seed: number) => {

    const newSeed = RNG.hash(seed); // produce a new seed
    const scaled = RNG.scale(newSeed); // scale the new seed in 

    const velocity = Constants.MIN_BOUNCE+ (scaled + 1) / 2 // to [0 , width]
        * (Constants.MAX_BOUNCE - Constants.MIN_BOUNCE);

    return [velocity, newSeed]; // return velocity + updated seed
}; 

/**
 * Check the pipe collision between bird and pipe only
 * @param birdX bird X position
 * @param birdY bird Y position
 * @param pipe pipe informations
 * @returns the collison happen or not in boolean form
 */ 

const checkPipeCollision = (birdX: number, birdY: number, pipe: Pipe) => {
    
    // Check when the right of bird shape is pass the left side of pipe shape
    if (birdX + Birb.WIDTH > pipe.x_axis && birdX < pipe.x_axis + Constants.PIPE_WIDTH) {

           // Check if bird pass from other places besides from the gap
        if (birdY < (pipe.gapY - pipe.gapHeight / 2) || birdY + Birb.HEIGHT > (pipe.gapY + pipe.gapHeight / 2)) {
            return { pipeCollision: true};
        }
    }
    
    return { pipeCollision: false};
};

/**
 * Pure function to detect all collisions and calculate bounce effects
 * @param s current state
 * @param newY proposed new Y position
 * @param pipes current pipes array
 * @returns collision result with all necessary information
 */
const detectCollisions = (s: State, newY: number, pipes: ReadonlyArray<Pipe>): Collision => {
    const hitTop = newY < 0;
    const hitBottom = newY + Birb.HEIGHT > Viewport.CANVAS_HEIGHT;
    const frameCollision = hitTop || hitBottom;
    
    
    // Check pipe collisions
    const pipeCollide= pipes
        .map(pipe => ({ pipe, collision: checkPipeCollision(s.birdX, newY, pipe) }))
        .filter(x => x.collision.pipeCollision);
    
    const pipeCollision = pipeCollide.length > 0;
    const hitPipe = pipeCollide.length > 0 ? pipeCollide[0].pipe.id : null;
 

    if ((frameCollision|| pipeCollision) === false) {
        return {
            frameCollision,
            pipeCollision,
            hitPipe,
            bounceVelocity: 0,
            latestSeed: s.rngSeed
        };
    }

    const [velocity, newSeed] = (frameCollision||pipeCollision) ? generateBounceVelocity(s.rngSeed) : [0, s.rngSeed];
    
    const bounceVelocity = frameCollision 
    ? (hitBottom ? -velocity : velocity) : pipeCollision
    ? (() => {
        const pipe = pipeCollide[0].pipe;
        const topHalfGap = pipe.gapY - pipe.gapHeight /2;
        const bottomHalfGap = pipe.gapY + pipe.gapHeight /2;
        return newY< topHalfGap ? velocity : newY + Birb.HEIGHT > bottomHalfGap ? -velocity: 0;
    }) () : 0;

    return {
        frameCollision,
        pipeCollision,
        hitPipe,
        bounceVelocity,
        latestSeed: newSeed,
    };
};

/**
 * Pure function to update physics based on collision results
 * @param s current state
 * @param newY proposed Y position
 * @param collision collision detection results
 * @returns updated physics state
 */
const birdAction = (s: State, newY: number, collision: Collision): UpAndDown => {
    
    if (collision.frameCollision || collision.pipeCollision) {
        return {
            // ensure bird not appear outside the frame
            newY: Math.max(0, Math.min(newY, Viewport.CANVAS_HEIGHT - Birb.HEIGHT)),
            newDropSpeed: collision.bounceVelocity,
            newSeed: collision.latestSeed
        };
    }
    return {
        newY,
        newDropSpeed: s.birdDropSpeed + Constants.GRAVITY,
        newSeed: s.rngSeed
    };
};

/**
 * Pure function to update score based on passed pipes
 * @param s current state
 * @param pipes current pipes
 * @param collision collision results
 * @returns score update results
 */
const updateScore = (s: State, pipes: ReadonlyArray<Pipe>, collision: Collision): Score => {

    const updatedNoScorePipes = (collision.pipeCollision && collision.hitPipe !== null) 
    ?[...s.noScorePipes, collision.hitPipe]
    : s.noScorePipes;
    
    // Calculate score and update pipe pass status
    const updatedPipes = pipes.map(pipe => {
        return (!pipe.pass && pipe.x_axis + Constants.PIPE_WIDTH < s.birdX && !(updatedNoScorePipes.filter(x => x === pipe.id).length > 0))
            ? { ...pipe, pass: true }
            : pipe;
    })

    const newScore = s.score + updatedPipes.filter(p => {
        const pipe = s.pipes.filter(x => x.id === p.id);
        return p.pass && !pipe[0].pass;
    }).length;

    return {
        newScore,
        updatedPipes,
        updatedNoScorePipes
    };
};

/**
 * Pure function to spawn new pipes based on time
 * @param pipeDetails pipe data from CSV
 * @param current current game time
 * @param previous previous game time
 * @returns new pipes array to spawn
 */
const spawnPipe = (pipeDetails: ReadonlyArray<PipeData>, current: number, previous: number): ReadonlyArray<Pipe> => {
    return pipeDetails.filter(pipe => 
            pipe.time <= current && pipe.time > previous
        )
        .map(pipe => ({
            x_axis: Viewport.CANVAS_WIDTH,
            gapY: pipe.gapY * Viewport.CANVAS_HEIGHT,
            gapHeight: pipe.gapHeight * Viewport.CANVAS_HEIGHT,
            id: pipe.num,
            pass: false,
        }));
};

/**
 * run the pipes with constant speed and remove the pipes that out of frame
 * @param pipes current pipes array
 * @returns pipe array
 */
const runPipe = (pipes: ReadonlyArray<Pipe>): ReadonlyArray<Pipe> => {
    return pipes
        .map(pipe => ({ 
            ...pipe, 
            x_axis: pipe.x_axis - Constants.PIPESPEED 
        }))
        .filter(pipe => pipe.x_axis + Constants.PIPE_WIDTH > 0);
};


/**
 * Reset the whole game function 
 * @param g current game state
 * @returns new game state
 */
const resetGame = (g: State): State => {
    if ((g.gameEnd) === false) {
        return g; // Only reset when game is over
    }

    // Save current recording if it has birdMovement
    const newRecording = {
        birdMovement: g.currentRecording,
        gameNum: g.gameNum,
        finalTick: g.currentTick
    };

    const updatedRecordings = [newRecording, ...g.ghostRecordings];

    // Initialize ghost record for new game
    const rerunGhost = updatedRecordings.map(recording => ({
        recording,
        currentScene: 0,
        isFinish: false
    }));

    return {
        ...initialState,
        gameNum: g.gameNum + 1,
        ghostRecordings: updatedRecordings,
        runGhost: rerunGhost,
    
    };
};

/**
 * store the current game state's bird's y axis into State.currentRecording
 * @param s current state
 * @returns ghost array
 */
const storeBird = (s: State): ReadonlyArray<Ghost> => {
   
    const newFrame = {
        Y: s.birdY,
        tick: s.currentTick
    };
    return [...s.currentRecording, newFrame]; 
};

/**
 * Updates ghost display list based on current game state
 * @param s current state
 * @returns displayGhost array
 */
const updateRunGhost = (s: State): ReadonlyArray<DisplayGhost> => 
    
    s.runGhost.map(playback => {
        if (playback.isFinish) {
            return playback;
        }

        const scene = playback.recording.birdMovement;
        const currentscene = scene[playback.currentScene];
        
        // Check if we need to advance to next frame
        if (currentscene && s.currentTick >= currentscene.tick) {
            const nextScene = playback.currentScene + 1;
            
            if (nextScene >= scene.length || s.currentTick > playback.recording.finalTick) {
                return { ...playback, isFinish: true };
            }
            
            return { ...playback, currentScene: nextScene };
        }
        
        return playback;
    });


/**
 * get current ghost positions 
 * @param s current state
 * @returns ghost posiition arraylist 
 */
const currentGhost = (s: State) => 
    
    s.runGhost.filter(playback => !(playback.isFinish))
    .map(p => {
            const background = p.recording.birdMovement;
            const current = background[p.currentScene];
            const next = background[p.currentScene + 1];
            
            const y = next && s.currentTick < next.tick
                ? current.Y + (next.Y - current.Y) * ((s.currentTick - current.tick) / (next.tick - current.tick))
                : current.Y;
            
            return { y, transparency: Constants.TRANSPARENCY, gameNum: p.recording.gameNum };
    });
    
/**
 * update ghost trail
 * @param s current state
 * @param birdY bird y axis
 * @returns the array of the trail 
 */
const updateGhostTrail = (s: State, birdY: number): ReadonlyArray<Trail> => {
    
    // to prevent the trail appear all time
    if (s.ghostTrailMode === false) {
        return [];
    }
    
    const newTrail: Trail = {
        y: birdY,
    };
    
    // Add new position and filter old ones based on array length
    return [newTrail, ...s.ghostTrail]     
        .slice(0, Constants.TRAIL_LENGTH);
};

/**
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick =(pipeDetails: ReadonlyArray<PipeData>) => (s: State) => {
    if (s.gameEnd){
        return s;
    }

    const dropSpeed = s.birdDropSpeed + Constants.GRAVITY;

    const proposedY = s.birdY + dropSpeed;

    const newPipeShowTime = s.pipeShowTime + Constants.TICK_RATE_MS / 1000;

    const newPipes = spawnPipe(pipeDetails, newPipeShowTime, s.pipeShowTime);

    const allPipes = [...runPipe(s.pipes), ...newPipes];

    const collision = detectCollisions(s, proposedY, allPipes);

    const action = birdAction(s, proposedY, collision);
    
    const scoreUpdate = updateScore(s, allPipes, collision);

    const anyCollision = (collision.frameCollision || collision.pipeCollision);
    
    const newLives = anyCollision ? s.lives - 1 : s.lives;

    const maxPipeTime = Math.max(...pipeDetails.map(p => p.time), 0);

    const pipesDone = newPipeShowTime > maxPipeTime;
    
    const gameWon = scoreUpdate.updatedPipes.every(pipe => pipe.pass) && scoreUpdate.updatedPipes.length > 0;
    
    const gameEnd = newLives <= 0 || gameWon ;
    
    const newTick = s.currentTick + 1; 
    
    const newRecording = storeBird({
        ...s,
        birdY: action.newY,
        currentTick: newTick
    });

    const runGhost = updateRunGhost({
        ...s,
        currentTick: newTick
    });

    const newGhostTrail = updateGhostTrail(s, action.newY);
    
    return {
        ...s,   
        gameEnd,
        gameWon,
        pipesDone,
        pipeShowTime: newPipeShowTime,
        pipes: scoreUpdate.updatedPipes,
        birdY: action.newY,
        birdDropSpeed: action.newDropSpeed,  
        lives: newLives,
        score: scoreUpdate.newScore,
        noScorePipes: scoreUpdate.updatedNoScorePipes,
        rngSeed: action.newSeed,
        currentTick: newTick,
        currentRecording: newRecording,
        runGhost,
        ghostTrail: newGhostTrail,
    }

}

/**
 * set the flap value to drop speed
 * @param s current game state
 * @returns state with updated drop speed
 */
const flyUp = (s: State): State => ({
    ...s,
    birdDropSpeed: s.flap,
})

/**
 * clear the trail when ghost trail mode is false (off)
 * @param s current game state
 * @return state with updated ghost trail mode, trail and flap value
 */
const switchMode = (s: State): State => ({
        ...s,
        ghostTrailMode: !s.ghostTrailMode,
        ghostTrail: !s.ghostTrailMode ? s.ghostTrail : [],
        flap: !s.ghostTrailMode? -10 : -5
})
   
// Rendering (side effects)

/**
 * Brings an SVG element to the foreground.
 * @param elem SVG element to bring to the foreground
 */
const bringToForeground = (elem: SVGElement): void => {
    elem.parentNode?.appendChild(elem);
};

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "visible");
    bringToForeground(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "hidden");
};

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
): SVGElement => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

const render = (): ((s: State) => void) => {
    // Canvas elements
    const gameOver = document.querySelector("#gameOver") as SVGElement;
    const gameWon = document.querySelector("#gameWon") as SVGElement;
    const replay = document.querySelector("#replay") as SVGElement;
    const additional= document.querySelector("#text") as SVGElement;
    const container = document.querySelector("#main") as HTMLElement;

    // Text fields
    const livesText = document.querySelector("#livesText") as HTMLElement;
    const scoreText = document.querySelector("#scoreText") as HTMLElement;
    

    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );

    // to set a layer inside svg, which enables to delete the bird and pipes every tick but not affect the other object
    const getOrCreateGameLayer = (): SVGGElement => {
        const existingGame = svg.querySelector("#gameLayer") as SVGGElement;
        if (existingGame) return existingGame;
        
        const newGame = createSvgElement(svg.namespaceURI, "g", { id: "gameLayer" }) as SVGGElement;
        svg.appendChild(newGame);
        return newGame;
    };

    // first update the all object in game layer then reset the game layer back to svg
    const game = getOrCreateGameLayer();

    /**
     * Renders the current state to the canvas.
     *
     * In MVC terms, this updates the View using the Model.
     *
     * @param s Current state
     */
    return (s: State) => {
        // Add birb to the main grid canvas
        game.innerHTML = "";

        if (s.ghost) {            
            currentGhost(s).forEach((ghost) => {
                const ghostImg = createSvgElement(svg.namespaceURI, "image", {

                    href: "assets/birb.png",
                    x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`, 
                    y: `${ghost.y}`,
                    width: `${Birb.WIDTH}`,
                    height: `${Birb.HEIGHT}`,
                    opacity: `${ghost.transparency}`,
                    
                });
                
                game.appendChild(ghostImg);
            });

            if (s.ghostTrail.length != 0) {
                s.ghostTrail.forEach((ghost, index) => {        
                    const ghostImg = createSvgElement(svg.namespaceURI, "image", {
                        href: "assets/birb.png",
                        x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
                        y: `${ghost.y}`,
                        width: `${Birb.WIDTH * (1 - (index * 0.05))}`,
                        height: `${Birb.HEIGHT * (1 - (index * 0.05))}`,
                        opacity: "0.3",
                  
                    }); 
                    game.appendChild(ghostImg);
                });
            }
        }

        //bird image
        const birdImg = createSvgElement(svg.namespaceURI, "image", {
            href: "assets/birb.png",
            x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
            y: `${s.birdY}`,
            width: `${Birb.WIDTH}`,
            height: `${Birb.HEIGHT}`,
        });
        game.appendChild(birdImg);

        s.pipes.forEach(pipe => {
        // Top pipe
        const pipeTop = createSvgElement(svg.namespaceURI, "rect", {
            x: `${pipe.x_axis}`,
            y: "0",
            width: `${Constants.PIPE_WIDTH}`,
            height: `${pipe.gapY - pipe.gapHeight / 2}`,
            fill: "green",
        });

        // Bottom pipe
        const pipeBottom = createSvgElement(svg.namespaceURI, "rect", {
            x: `${pipe.x_axis}`,
            y: `${pipe.gapY + pipe.gapHeight / 2}`,
            width: `${Constants.PIPE_WIDTH}`,
            height: `${Viewport.CANVAS_HEIGHT - (pipe.gapY + pipe.gapHeight / 2)}`,
            fill: "green",
        });

        game.appendChild(pipeTop);
        game.appendChild(pipeBottom);
    });


    if (livesText) livesText.textContent = `${s.lives}`;
    if (scoreText) scoreText.textContent = `${s.score}`;
    if (s.gameEnd) {
        if (s.gameWon) {
            show(gameWon);
            hide(gameOver);
            show(replay);
        } else {
            show(gameOver);
            hide(gameWon);
            show(replay);
        }
    } else {
        hide(gameOver);
        hide(gameWon);
        hide(replay);
    }
    show(additional);


};
};


/**
 * Convert into an observable stream 
 */
export const state$ = (csvContents: string): Observable<State> => {
    /** User input */
    const pipeDetails = readFile(csvContents);

    const key$ = fromEvent<KeyboardEvent>(document, "keydown");
    const fromKey = (keyCode: Key) =>
        key$.pipe(filter(({ code }) => code === keyCode));

    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS);
    const flap$ = fromKey("Space");
    const replay$ = fromKey("KeyR");
    const trailMode$ = fromKey("KeyG");

    return merge( 
        tick$.pipe(map(() => tick(pipeDetails))),
        flap$.pipe(filter(e => !e.repeat), map(() => flyUp)),
        replay$.pipe(map(() => resetGame)),
        trailMode$.pipe(map(() => switchMode))

    ).pipe(scan(
        (state, reducer) => reducer(state), initialState
    ))
    ;
};

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    const { protocol, hostname, port } = new URL(import.meta.url);
    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    const csvUrl = `${baseUrl}/assets/map.csv`;

    // Get the file from URL
    const csv$ = fromFetch(csvUrl).pipe(
        switchMap(response => {
            if (response.ok) {
                return response.text();
            } else {
                throw new Error(`Fetch error: ${response.status}`);
            }
        }),
        catchError(err => {
            console.error("Error fetching the CSV file:", err);
            throw err;
        }),
    );

    // Observable: wait for first user click
    const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

    csv$.pipe(
        switchMap(contents =>
            // On click - start the game
            click$.pipe(switchMap(() => state$(contents))),
        ),
    ).subscribe(render());
}
