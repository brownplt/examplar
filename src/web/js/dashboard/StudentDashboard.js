import React, { Component } from 'react';
import GoogleAPI from './GoogleAPI.js';
import {CLIENT_ID, FILE_EXT, APP_NAME, COLLECTION_NAME, API_KEY} from './config.js';
import Assignment from './Assignment';

const NOT_SIGNED_IN = 1;
const WAITING_FOR_SIGNIN = 2;
const SIGNED_IN = 3;
const INITIAL_LOAD = 4;


const WAITING_FOR_FILES = [];


class StudentDashboard extends Component {
  constructor() {
    super();

    this.state = {
      signedIn: INITIAL_LOAD,
      activeTab: 'recent-assignments',
      assignments: [],
      userName: false
    };

    this.api = new GoogleAPI();
    var apiLoaded = this.api.load();
    apiLoaded.then((resp) => {
      if(resp.hasAuth()) {
        this.setState({signedIn: SIGNED_IN});
        this.updateRecentAssignments();
        this.api.getUsername().then((userInfo) => {
          this.setState({ userName: userInfo.emails[0].value });
        });
      }
      else {
        this.setState({ signedIn: NOT_SIGNED_IN });
      }
    });
    apiLoaded.fail((e) => {
      this.setState({ signedIn: NOT_SIGNED_IN });
    });
  }

  handleStartCodingClick = (event) => {
    window.open("/editor", "_blank");
  }

  handleSignInClick = (event) => {
    this.setState({signedIn: WAITING_FOR_SIGNIN});
    this.api.signIn().then((resp) => {
      this.setState({signedIn: SIGNED_IN});
      this.api.getUsername().then((userInfo) => {
        this.setState({ userName: userInfo.emails[0].value });
      });
      this.updateRecentAssignments();
    })
    .fail((resp) => {
      this.setState({ signedIn: NOT_SIGNED_IN });
    });
  }

  handleSignOutClick = (event) => {
    this.setState({signedIn: NOT_SIGNED_IN});
    window.location.replace('/logout');
  }

  handleTabClick = (event) => {
    this.setState({activeTab: event.target.id});
    if (event.target.id === 'recent-assignments') {
      this.updateRecentAssignments();
    }
  }

  updateRecentAssignments = () => {
    this.setState({assignments: WAITING_FOR_FILES});
    this.api.getRecentAssignments(COLLECTION_NAME).then((resp) => {
      this.setState({assignments: resp});
    })
  }

  handleNewFilenameChange = (event) => {
    this.setState({newFileName: event.target.value});
  }

  // A simple callback implementation.
  pickerCallback = (data) => {
    if (data.action === window.google.picker.Action.PICKED) {
      var fileId = data.docs[0].id;
      window.open(EDITOR_REDIRECT_URL + fileId, "_blank");
    }
  }

  render = () => {
    return (
      <div className='wrap'>
        <div id='header' className=''>
          <div className='container'>
            <div className='left' aria-label='Welcome to Pyret'>
              <img src='/img/pyret-logo.png' aria-hidden='true' className='dashboard-logo'></img>
              <div className='header'>
                <h1 className='logo-text'>{APP_NAME}</h1>
                <h2 className={'person-text ' + (this.state.userName === false ? 'hidden' : '')}>{this.state.userName}</h2>
              </div>
            </div>
            <div className='button-wrapper right'>
              <button className={'auth-button ' + (this.state.signedIn !== NOT_SIGNED_IN ? '' : 'hidden')} onClick={this.handleSignOutClick} id='signout-button' >Sign out</button>
            </div>
          </div>
        </div>
        <div className={'main middle container ' + (this.state.signedIn === NOT_SIGNED_IN ? '' : 'hidden')}>

          <div className={'middle large-logo-container'} aria-label='Pyret'>
            <img src="/img/pyret-logo.png" aria-hidden='true'></img>
          </div>

          <div className='clearfix'></div>

          <div>
            <p><button className={'auth-button'} onClick={this.handleSignInClick} id='signin-button' >Sign in</button></p><p><em>to save and view programs</em></p>
          </div>

          <div className='clearfix'></div>

          <br/><br/>

          <p>You can also check out <a href="http://papl.cs.brown.edu" aria-label="Pyret book">our book that uses Pyret</a> or <a href="http://www.bootstrapworld.org" aria-label="Bootstrap curricula">our curricula</a>.</p>

        </div>
        <div id='loading-spinner' className={this.state.signedIn === WAITING_FOR_SIGNIN ? '' : 'hidden'}>
          <h1>Waiting for login...</h1>
          <i className='fa fa-circle-o-notch fast-spin fa-3x fa-fw'></i>
        </div>
        <div id='file-picker-modal' className={'modal-wrap container ' + (this.state.signedIn === SIGNED_IN ? '' : 'hidden')}>
          <div id='file-picker-modal-tabs' className='cf'>
            <h2 id='recent-assignments' className={'tab floatable left ' + ((this.state.activeTab === 'recent-assignments') ? 'active' : '')} onClick={this.handleTabClick}>Recent Assignments</h2>
          </div>
          <div id='file-picker-modal-body' className={'modal-body ' + ((this.state.activeTab === 'recent-assignments') ? '' : 'hidden')}>
            {
              this.state.assignments === WAITING_FOR_FILES ?
              (<div id='loading-spinner'>
                <h2>Loading assignments...</h2>
                <i className='fa fa-circle-o-notch fast-spin fa-3x fa-fw'></i>
              </div>)
              :
                this.state.assignments.length > 0 ?
                    (<div className='file-list cf'>
                      {this.state.assignments.map((f) => {return <Assignment key={f.id} id={f.id} name={f.name} />;})}
                    </div>)
                  :
                    <p><em>No Pyret assignments yet.</em></p>
            }
          </div>
        </div>
        <div className='footer middle'>
          <p className='right'>
            <a target="_blank" href="https://www.pyret.org">pyret.org</a> | <a target="_blank" href="/privacy/">Privacy</a> | <a target="_blank" href="https://www.github.com/brownplt/code.pyret.org">Software</a></p>
        </div>

      </div>
    );
  }
}

export default StudentDashboard;
