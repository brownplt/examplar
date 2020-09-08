import React, { Component } from 'react';

class Assignment extends Component {
  render = () => {
    return (
        <div className='file-wrapper'>
          <div className="file" onClick={this.handleFileClick}>
            <img src='/img/pyret-logo.png'/>
            <span className='truncate'>{this.props.name}</span>
          </div>
        </div>
    );
  }

  handleFileClick = () => {
    window.open(ASSIGNMENT_REDIRECT_URL + this.props.id);
  }
}

export default Assignment;
