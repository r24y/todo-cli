import uuid from 'uuid';
//-- type UUID = string
import fs from 'fs';
import co from 'co';
import chalk from 'chalk';
import path from 'path';
import tmp from 'tmp';
import editor from 'editor';
import yaml from 'js-yaml';
import React, {Component} from 'react';
import blessed from 'blessed';
import {render} from 'react-blessed';

tmp.setGracefulCleanup();

//-- type Status = string
const Status = {
  READY: 'ready',
  IN_PROGRESS: 'in-progress',
  BLOCKED: 'blocked',
  COMPLETE: 'complete',
};

const STATUS_DISPLAY = {
  [Status.READY]: ' ',
  [Status.IN_PROGRESS]: '…',
  [Status.BLOCKED]: '⌛',
  [Status.COMPLETE]: '✓',
};

const STATUS_COLORS = {
  [Status.READY]: chalk.white,
  [Status.IN_PROGRESS]: chalk.blue,
  [Status.BLOCKED]: chalk.red,
  [Status.COMPLETE]: chalk.green,
};

/*-- type Estimate = {
       lowEstimate :: number     -- in minutes; lowest amount of time this is likely to take
       highEstimate :: number    -- in minutes; highest amount of time this is likely to take
     } */

/*-- type OccurrenceTime = Date */

//-- type TodoID = UUID
class Todo {
  //-- _id :: TodoID
  //-- title :: string
  //-- status :: Status
  //-- estimate :: Estimate?
  //-- deadline :: Deadline?
  //-- dependentIDs :: [TodoID]

  /*-- constructor :: ({
         _id :: TodoID
         title :: String
         status :: Status            -- Completion status of the Todo.
         estimate :: Estimate?       -- How long it's expected this task will take.
         deadline :: OccurrenceTime? -- When this Todo is due.
         dependentIDs :: [TodoID]    -- IDs of Todos that are blocked by this one.
       }) -> Todo */
  constructor({
    _id = uuid.v1(),
    title = '',
    status = Status.READY,
    estimate = null,
    deadline = null,
    dependentIDs = [],
  }={}) {
    this._id = _id;
    this.title = title;
    this.status = status;
    this.estimate = estimate;
    this.deadline = deadline;
    this.dependentIDs = dependentIDs;
  }
  //-- toJSON :: () -> object
  toJSON() {
    return {
      _id: this.id,
      title: this.title,
      status: this.status,
      estimate: this.estimate,
      deadline: this.deadline,
      dependentIDs: this.dependentIDs,
    };
  }
  toPrettyString() {
    const statusBox = STATUS_DISPLAY[this.status];
    return `${statusBox} ${this.title}`;
  }
}

function prettyPrintTodo({_id, title, status, estimate, deadline}) {
  return (`${_id}. ${STATUS_DISPLAY[status]} ${title}`);
}

//-- type EventID = UUID
//-- type Duration = number -- in milliseconds
/*-- type Cause = {
       type :: ("Todo")
       value :: case type of
     }
*/

class Event {
  //-- _id :: EventID
  //-- title :: string
  //-- start :: OccurrenceTime?
  //-- duration :: Duration
  //-- causes :: [Cause]

  /*-- constructor :: ({
         _id :: EventID
        title :: string
        start :: OccurrenceTime?
        duration :: Duration
        causes :: [Cause]
       })*/
  constructor({
    _id = uuid.v1(),
    title = '',
    start = null,
    duration= 0,
    causes = [],
  } = {}) {
    this._id = _id;
    this.title = title;
    this.start = start;
    this.duration = duration;
    this.causes = causes;
  }
}

function getUserHome() {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}

const TODO_CREATE = 'agenda/todo/create';
const TODO_SET_TITLE = 'agenda/todo/set/title';
const TODO_SET_STATUS = 'agenda/todo/set/status';
const TODO_SET_ESTIMATE = 'agenda/todo/set/estimate';
const TODO_SET_DEADLINE = 'agenda/todo/set/deadline';
const TODO_ADD_DEPENDENT = 'agenda/todo/dependent/add';
const TODO_REMOVE_DEPENDENT = 'agenda/todo/dependent/remove';
const TODO_DESTROY = 'agenda/todo/destroy';

const EVENT_CREATE = 'agenda/event/create';
const EVENT_SET_TITLE = 'agenda/event/set/title';
const EVENT_SET_START = 'agenda/event/set/start';
const EVENT_SET_DURATION = 'agenda/event/set/duration';
const EVENT_ADD_CAUSE = 'agenda/event/cause/add';
const EVENT_REMOVE_CAUSE = 'agenda/event/cause/remove';
const EVENT_DESTROY = 'agenda/event/destroy';

const defaultState = {
  todos: {},
  events: {},
};

function reducer(state = defaultState, action) {
  const {type, todoId} = action;
  switch (action.type) {
    case TODO_CREATE: return {
      ...state,
      todos: {
        ...state.todos,
        [todoId]: {
          status: Status.READY,
          dependentIDs: [],
          ...action.todo,
          _id: todoId
        },
      },
    };
    case TODO_SET_TITLE: return {
      ...state,
      todos: {
        ...state.todos,
        [todoId]: {
          ...state.todos[todoId],
          title: action.title,
        },
      },
    };
    case TODO_SET_STATUS: return {
      ...state,
      todos: {
        ...state.todos,
        [todoId]: {
          ...state.todos[todoId],
          status: action.status,
        }
      }
    };
    case TODO_SET_ESTIMATE: return {
      ...state,
      todos: {
        ...state.todos,
        [todoId]: {
          ...state.todos[todoId],
          estimate: action.estimate,
        },
      },
    };
    case TODO_SET_DEADLINE: return {
      ...state,
      todos: {
        ...state.todos,
        [todoId]: {
          ...state.todos[todoId],
          deadline: action.deadline,
        },
      },
    };
    case TODO_ADD_DEPENDENT: return {
      ...state,
      todos: {
        ...state.todos,
        [todoId]: {
          ...state.todos[todoId],
          dependentIDs: state.todos[todoId].dependentIDs.concat([action.dependentId]),
        },
      },
    };
    case TODO_REMOVE_DEPENDENT: return {
      ...state,
      todos: {
        ...state.todos,
        [todoId]: {
          ...state.todos[todoId],
          dependentIDs: state.todos[todoId].dependentIDs.filter(x => x !== action.dependentId)
        },
      },
    };
    case TODO_DESTROY:
      const newTodos = {...state.todos};
      delete newTodos[todoId];
      return {
        ...state,
        todos: newTodos,
      };
    default: return state;
  }
}

class AgendaState {
  constructor() {
    this.todos = {};
    this.events = {};
  }
  *initialize() { /* noop */ }
  *handleAction(action) {
    const {todos, events} = reducer(this, action);
    this.todos = todos;
    this.events = events;
  }
  //-- resolveTodo :: Generator<(TodoID) /-> Todo?>
  *resolveTodo(todoID) {
    return this.todos[todoID];
  }
  //-- abstract resolveEvent :: Generator<(EventID) /-> Event?>
  *resolveEvent(eventID) {
    return this.events[eventID];
  }
}

co(function *() {
  const yamlSrc = yield new Promise((resolve, reject) => {
    fs.readFile(path.join(getUserHome(), '.todo.yaml'), (err, contents) => {
      if (err) return reject(err);
      return resolve(contents);
    })
  });
  const events = [];
  yaml.safeLoadAll(yamlSrc, event => events.push(event));
  let state;
  events.forEach(event => state = reducer(state, event));
  const items = Object.keys(state.todos).map(id => {
    return prettyPrintTodo(state.todos[id]);
  });
  const screen = blessed.screen({
    autoPadding: true,
    smartCSR: true,
    title: 'todo',
  });
  screen.key(['escape', 'q', 'C-c'], function(ch, key) {
    return process.exit(0);
  });
  screen.enableMouse();
  const app = render(<App items={items}/>, screen);
}).catch(err => {
  console.error(err.stack);
});

class App extends Component {
  componentDidMount() {
    this.refs.list.select(0);
  }
  render() {
    return (<element>
      <textbox
        ref="todo"
        border={{type: 'line'}}
        width="100%"
        top="0"
        height={3}
        left="0"
        width="100%"
        mouse={true}
        inputOnFocus={true}
      />
      <list
        ref="list"
        items={this.props.items}
        top={3}
        bottom="0"
        left="0"
        right="0"
        mouse={true}
        vi={true}
        interactive={true}
        invertSelected={true}
        inputOnFocus={true}
        style={{
          selected: {
            fg: 'black',
            bg: 'white',
          }
        }}
        border={{type: 'line', fg: 'green'}}
      />
    </element>);
  }
}
